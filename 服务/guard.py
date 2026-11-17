"""护栏：开关、大小/类型、按 IP 与全局的每日次数、并发限额、产物过期清理。

对应契约 §4。所有失败都以 :class:`errors.ToolError` 抛出，``message`` 是直接给访客看的中文文案。

设计要点：

* 作业目录与产物目录都由本模块创建/管理，**目录名一律是服务端生成的 UUID**，
  用户上传的原始文件名从不参与路径拼接。
* 每日计数落在 ``data/guard-state.json``（原子替换 + 权限 600），服务重启不会重置额度。
* IP 只以加盐 SHA-256 的形式落盘，不做明文留存。
* 时间统一用本机时区（服务器是 Asia/Shanghai，正好对应「每日」）。
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import deque
import json
import logging
import os
import re
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from errors import ToolError

log = logging.getLogger(__name__)

JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_IP_SALT = None
_CHUNK = 64 * 1024

def _load_ip_salt(data_dir: Path) -> bytes:
    path = data_dir / "ip-hmac-key"
    if not path.exists():
        try:
            fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(fd, "wb") as handle:
                handle.write(secrets.token_bytes(32))
                handle.flush()
                os.fsync(handle.fileno())
    key = path.read_bytes()
    if len(key) != 32:
        raise RuntimeError("IP hash key is invalid")
    return key


def _atomic_write_json(path: Path, payload: Dict[str, Any], mode: int = 0o600) -> None:
    tmp = path.with_name(path.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.flush()
        os.fsync(fh.fileno())
    try:
        os.chmod(tmp, mode)
    except OSError:  # pragma: no cover - 非 POSIX
        pass
    os.replace(str(tmp), str(path))


def hash_ip(ip: str) -> str:
    """IP 脱敏：只存加盐哈希前 16 位。"""
    if _IP_SALT is None:
        raise RuntimeError("Guard must be initialized before hashing IP addresses")
    return hmac.new(_IP_SALT, str(ip).encode("utf-8"), hashlib.sha256).hexdigest()[:16]


class Guard:
    """所有「能不能做」的判断集中在这里。"""

    def __init__(self, config: Dict[str, Any], clock: Optional[Callable[[], datetime]] = None) -> None:
        self.config = config
        self._clock = clock or datetime.now
        self._lock = threading.RLock()

        self.data_dir = Path(config["data_dir"])
        self.work_root = self.data_dir / "work"
        self.files_root = self.data_dir / "files"
        self._state_path = self.data_dir / "guard-state.json"
        self._recent_requests = {}

        self.max_bytes = int(config["max_file_mb"]) * 1024 * 1024
        self.allowed_extensions = list(config["allowed_extensions"])

        for directory in (self.data_dir, self.work_root, self.files_root):
            directory.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(directory, 0o700)
            except OSError:  # pragma: no cover
                pass

        self._state = self._load_state()
        global _IP_SALT
        _IP_SALT = _load_ip_salt(self.data_dir)

    # ------------------------------------------------------------------ 开关
    @property
    def enabled(self) -> bool:
        return bool(self.config.get("enabled", True))

    def require_enabled(self) -> None:
        if not self.enabled:
            raise ToolError(
                503,
                "工具当前已停用（服务端紧急开关 enabled=false），请稍后再试",
            )

    # -------------------------------------------------------------- 文件校验
    def check_upload(self, filename: str, size_bytes: Optional[int] = None) -> str:
        """校验文件名/大小，返回不带点的扩展名（小写）。"""
        name = (filename or "").strip()
        if not name:
            raise ToolError(400, "请选择要上传的文件")

        suffix = Path(name).suffix.lower().lstrip(".")
        if not suffix:
            raise ToolError(
                400,
                "无法识别文件类型（没有扩展名）。仅支持：" + " / ".join(self.allowed_extensions),
            )
        if suffix not in self.allowed_extensions:
            raise ToolError(
                400,
                f"不支持的文件类型：.{suffix}（仅支持：{' / '.join(self.allowed_extensions)}）",
            )

        if size_bytes is not None and size_bytes > self.max_bytes:
            raise ToolError(413, f"文件超过 {self.config['max_file_mb']}MB")

        return suffix

    def save_upload(self, file_storage, dest: Path) -> int:
        """把上传流写到 ``dest``，边写边限长（防止伪造 Content-Length）。

        返回写入字节数。超出大小限制时抛 413，并清理半成品文件。
        """
        dest.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        try:
            with dest.open("wb") as fh:
                while True:
                    chunk = file_storage.stream.read(_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > self.max_bytes:
                        raise ToolError(413, f"文件超过 {self.config['max_file_mb']}MB")
                    fh.write(chunk)
        except Exception:
            try:
                dest.unlink()
            except FileNotFoundError:
                pass
            raise

        if total == 0:
            raise ToolError(400, "上传的文件是空的，请重新选择文件")
        return total

    # ---------------------------------------------------------------- 作业目录
    @staticmethod
    def new_job_id() -> str:
        return uuid.uuid4().hex

    @staticmethod
    def require_job_id(job_id: str) -> str:
        """只接受 32 位小写十六进制 UUID，杜绝 ``../`` 之类路径穿越。"""
        job_id = (job_id or "").strip().lower()
        if not JOB_ID_RE.match(job_id):
            raise ToolError(400, "作业 ID 格式不正确")
        return job_id

    def work_dir(self, job_id: str) -> Path:
        job_id = self.require_job_id(job_id)
        path = self.work_root / job_id
        path.mkdir(parents=True, exist_ok=False)
        try:
            os.chmod(path, 0o700)
        except OSError:  # pragma: no cover
            pass
        return path

    def remove_work_dir(self, job_id: str) -> None:
        if not JOB_ID_RE.match(job_id or ""):
            return
        shutil.rmtree(str(self.work_root / job_id), ignore_errors=True)

    def artifact_path(self, job_id: str, ext: str) -> Path:
        job_id = self.require_job_id(job_id)
        ext = str(ext).lower().lstrip(".")
        if ext not in ("pdf", "tex"):
            raise ToolError(400, "不支持的产物类型")
        return self.files_root / f"{job_id}.{ext}"

    # ------------------------------------------------------------ 每日计数
    def _load_state(self) -> Dict[str, Any]:
        default = {"date": self._today(), "global": 0, "ips": {}}
        try:
            with self._state_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return default
        if not isinstance(data, dict):
            return default
        ips = data.get("ips")
        if not isinstance(ips, dict):
            ips = {}
        return {
            "date": str(data.get("date") or self._today()),
            "global": int(data.get("global") or 0),
            "ips": {str(k): int(v) for k, v in ips.items()},
        }

    def _today(self) -> str:
        return self._clock().strftime("%Y-%m-%d")

    def _rollover_if_needed(self) -> None:
        today = self._today()
        if self._state.get("date") != today:
            self._state = {"date": today, "global": 0, "ips": {}}

    def _persist_locked(self) -> None:
        try:
            _atomic_write_json(self._state_path, self._state)
        except OSError as exc:  # 磁盘只读等极端情况：内存计数仍然生效
            log.warning("写入护栏计数文件失败（仅内存计数）：%s", exc)

    def reserve_daily(self, ip: str) -> Dict[str, int]:
        """占用一次「今日作业额度」，返回剩余次数。超限抛 429。"""
        per_ip_limit = int(self.config["per_ip_daily_limit"])
        global_limit = int(self.config["global_daily_limit"])
        key = hash_ip(ip)

        with self._lock:
            self._rollover_if_needed()
            ip_count = int(self._state["ips"].get(key, 0))

            if per_ip_limit > 0 and ip_count >= per_ip_limit:
                raise ToolError(
                    429,
                    f"该 IP 今日次数已用完（每天 {per_ip_limit} 次），请明天再试",
                )
            if global_limit > 0 and int(self._state["global"]) >= global_limit:
                raise ToolError(
                    429,
                    f"今日全站生成次数已用完（每天 {global_limit} 次），请明天再试",
                )

            ip_count += 1
            self._state["ips"][key] = ip_count
            self._state["global"] = int(self._state["global"]) + 1
            self._persist_locked()

            return {
                "ip_remaining": max(0, per_ip_limit - ip_count) if per_ip_limit > 0 else -1,
                "global_remaining": (
                    max(0, global_limit - int(self._state["global"])) if global_limit > 0 else -1
                ),
            }

    def today_usage(self) -> Dict[str, int]:
        with self._lock:
            self._rollover_if_needed()
            return {"global": int(self._state["global"]), "ips": len(self._state["ips"])}

    # ---------------------------------------------------------------- 清理
    def check_request_rate(self, ip: str, category: str) -> None:
        limits = {
            "upload": int(self.config["upload_rate_per_minute"]),
            "read": int(self.config["read_rate_per_minute"]),
        }
        limit = limits.get(category, 0)
        if limit <= 0:
            return
        now = time.monotonic()
        identity = (hash_ip(ip), category)
        with self._lock:
            entries = self._recent_requests.setdefault(identity, deque())
            while entries and now - entries[0] >= 60:
                entries.popleft()
            if len(entries) >= limit:
                raise ToolError(429, "请求过于频繁，请一分钟后重试")
            entries.append(now)
            if len(self._recent_requests) > 4096:
                for key, bucket in list(self._recent_requests.items()):
                    if not bucket or now - bucket[-1] >= 60:
                        self._recent_requests.pop(key, None)

    def check_daily(self, ip: str) -> None:
        """Reject exhausted quotas before accepting/uploading large request bodies."""
        key = hash_ip(ip)
        with self._lock:
            self._rollover_if_needed()
            per_ip_limit = int(self.config["per_ip_daily_limit"])
            global_limit = int(self.config["global_daily_limit"])
            if per_ip_limit > 0 and int(self._state["ips"].get(key, 0)) >= per_ip_limit:
                raise ToolError(429, "该 IP 今日次数已用完，请明天再试")
            if global_limit > 0 and int(self._state["global"]) >= global_limit:
                raise ToolError(429, "今日全站生成次数已用完，请明天再试")

    def cleanup(self, now: Optional[datetime] = None) -> Dict[str, int]:
        """删除超过保留期的产物与遗留作业目录（默认 2 小时）。"""
        now = now or self._clock()
        cutoff = now.timestamp() - int(self.config["artifact_ttl_seconds"])
        removed = {"files": 0, "workdirs": 0}

        for path in self.files_root.glob("*"):
            try:
                if path.is_file() and path.stat().st_mtime < cutoff:
                    path.unlink()
                    removed["files"] += 1
            except OSError as exc:  # pragma: no cover - 并发删除
                log.warning("清理产物 %s 失败：%s", path, exc)

        for path in self.work_root.glob("*"):
            try:
                if path.is_dir() and path.stat().st_mtime < cutoff:
                    shutil.rmtree(str(path), ignore_errors=True)
                    removed["workdirs"] += 1
            except OSError as exc:  # pragma: no cover
                log.warning("清理作业目录 %s 失败：%s", path, exc)

        if removed["files"] or removed["workdirs"]:
            log.info("过期清理：产物 %d 个，作业目录 %d 个", removed["files"], removed["workdirs"])
        return removed
