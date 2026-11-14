"""配置加载。

优先级（后面的覆盖前面的）：

1. :data:`DEFAULT_CONFIG`（安全默认值）
2. ``服务/config.json``（可用环境变量 ``STORM_TOOLS_CONFIG`` 指定别的路径）
3. 环境变量 ``DEEPSEEK_API_KEY`` / ``DEEPSEEK_MODEL`` / ``DEEPSEEK_BASE_URL``

安全约束：**代码与仓库里没有任何真实 key**。Key 只可能来自服务器上的
``服务/config.json``（权限 600）或环境变量；本模块只会把它读进内存，
不会写日志、不会下发给前端。
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

SERVICE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SERVICE_DIR.parent

DEFAULT_CONFIG: Dict[str, Any] = {
    # ---- 总开关 / 大模型 ----
    "enabled": True,
    "deepseek_api_key": "",
    "base_url": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "job_reasoning_effort": "high",
    "temperature": 0.2,
    "max_tokens": 4096,
    # ---- 监听地址（只监听本机，由 nginx 反代 /api/）----
    "host": "127.0.0.1",
    "port": 5000,
    # ---- 护栏（契约 §4）----
    "max_file_mb": 20,
    "allowed_extensions": ["pdf", "pptx", "docx", "txt", "png", "jpg", "jpeg", "webp"],
    "per_ip_daily_limit": 5,
    "global_daily_limit": 50,
    "llm_timeout_seconds": 120,
    "tex_timeout_seconds": 60,
    # xelatex 子进程虚拟内存上限（MB，0 = 不限制）。服务器 1888MB 内存，实测峰值 300~600MB。
    "tex_memory_limit_mb": 900,
    "queue_concurrency": 1,
    "queue_max_size": 20,
    "artifact_ttl_seconds": 7200,
    "cleanup_interval_seconds": 300,
    # ---- 文本抽取 ----
    "max_input_chars": 60000,
    "max_pdf_pages": 80,
    "ocr_lang": "chi_sim+eng",
    # ---- 路径 ----
    "data_dir": str(SERVICE_DIR / "data"),
    "templates_dir": str(SERVICE_DIR / "templates"),
    "prompts_dir": str(SERVICE_DIR / "prompts"),
    "english_notes_path": "",
    "project_root": str(PROJECT_ROOT),
    # ---- LaTeX ----
    "compile_pdf": True,
    "xelatex_path": "",  # 留空 = 从 PATH 查找
    # ---- 运行 ----
    "trust_proxy": True,  # 只信任本机 nginx 传来的 X-Real-IP
    "start_workers": True,
    "version": "1.0.0",
}

_INT_KEYS = {
    "max_file_mb",
    "per_ip_daily_limit",
    "global_daily_limit",
    "llm_timeout_seconds",
    "tex_timeout_seconds",
    "tex_memory_limit_mb",
    "queue_concurrency",
    "queue_max_size",
    "artifact_ttl_seconds",
    "cleanup_interval_seconds",
    "max_input_chars",
    "max_pdf_pages",
    "max_tokens",
    "port",
}


def _normalize(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """类型与路径规整，保证下游拿到干净的值。"""
    out = dict(cfg)

    for key in _INT_KEYS:
        try:
            out[key] = int(out[key])
        except (TypeError, ValueError):
            out[key] = DEFAULT_CONFIG[key]
        if out[key] < 0:
            out[key] = DEFAULT_CONFIG[key]

    # 并发至少为 1；队列至少能放 1 个
    out["queue_concurrency"] = max(1, out["queue_concurrency"])
    out["queue_max_size"] = max(1, out["queue_max_size"])
    out["max_file_mb"] = max(1, out["max_file_mb"])
    out["artifact_ttl_seconds"] = max(60, out["artifact_ttl_seconds"])

    # 扩展名统一成小写、不带点
    exts = out.get("allowed_extensions") or DEFAULT_CONFIG["allowed_extensions"]
    out["allowed_extensions"] = sorted(
        {str(e).strip().lower().lstrip(".") for e in exts if str(e).strip()}
    )

    out["enabled"] = bool(out.get("enabled", True))
    out["compile_pdf"] = bool(out.get("compile_pdf", True))
    out["trust_proxy"] = bool(out.get("trust_proxy", True))
    out["start_workers"] = bool(out.get("start_workers", True))
    effort = str(out.get("job_reasoning_effort") or "").strip().lower()
    out["job_reasoning_effort"] = effort if effort in ("low", "high", "max") else None

    base = SERVICE_DIR

    def _path(key: str, default: Path) -> None:
        raw = str(out.get(key) or "").strip()
        p = Path(raw).expanduser() if raw else default
        if not p.is_absolute():
            p = (base / p).resolve()
        out[key] = str(p)

    _path("data_dir", base / "data")
    _path("templates_dir", base / "templates")
    _path("prompts_dir", base / "prompts")
    _path("project_root", PROJECT_ROOT)

    notes = str(out.get("english_notes_path") or "").strip()
    if notes:
        p = Path(notes).expanduser()
        if not p.is_absolute():
            p = (Path(out["project_root"]) / p).resolve()
        out["english_notes_path"] = str(p)
    else:
        out["english_notes_path"] = ""

    return out


def load_config(path: Optional[str] = None) -> Dict[str, Any]:
    """读取配置文件并叠加环境变量。配置文件不存在/损坏时退回安全默认值。"""
    cfg: Dict[str, Any] = dict(DEFAULT_CONFIG)

    config_path = Path(
        path
        or os.environ.get("STORM_TOOLS_CONFIG")
        or (SERVICE_DIR / "config.json")
    )
    if config_path.is_file():
        try:
            with config_path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
            if isinstance(data, dict):
                # 忽略 "_说明" 之类的注释键
                cfg.update({k: v for k, v in data.items() if not str(k).startswith("_")})
            else:
                log.warning("配置文件 %s 顶层不是 JSON 对象，已忽略", config_path)
        except (OSError, ValueError) as exc:
            log.warning("读取配置文件 %s 失败，使用默认配置：%s", config_path, exc)
    else:
        log.info("未找到配置文件 %s，使用默认配置", config_path)

    # 环境变量覆盖（Key 只从这里或 config.json 来）
    env_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if env_key:
        cfg["deepseek_api_key"] = env_key
    for env_name, key in (
        ("DEEPSEEK_BASE_URL", "base_url"),
        ("DEEPSEEK_MODEL", "model"),
        ("STORM_TOOLS_PORT", "port"),
    ):
        value = os.environ.get(env_name, "").strip()
        if value:
            cfg[key] = value

    return _normalize(cfg)


def build_config(overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """测试/嵌入用：默认值 + overrides（不读磁盘配置文件）。"""
    cfg = dict(DEFAULT_CONFIG)
    if overrides:
        cfg.update({k: v for k, v in overrides.items() if not str(k).startswith("_")})
    return _normalize(cfg)


def redacted(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """去掉 key 的配置副本，用于日志或健康检查。"""
    safe = {k: v for k, v in cfg.items() if k != "deepseek_api_key"}
    safe["deepseek_api_key"] = "***" if cfg.get("deepseek_api_key") else ""
    return safe
