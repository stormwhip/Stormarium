"""异步作业状态机。

状态流转（契约 §3.2）：``queued → extracting → llm → typesetting → done / error``。

* ``submit`` 只是把作业放进队列，立即返回 UUID；
* 固定 ``queue_concurrency`` 个后台线程顺序消费队列（默认 1，避免 2GB 内存被打爆）；
* 每个作业一个独立临时目录，结束（无论成败）立即删除；
* 产物（.pdf / .tex）放到 ``data/files``，由 :class:`guard.Guard` 按 2 小时 TTL 清理；
* 作业里**不保存用户上传的原始文件名**，所有路径都用服务端生成的 UUID。
"""

from __future__ import annotations

import logging
import queue
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from errors import ToolError
from extract import extract_text
from guard import hash_ip
from prompts.loader import build_prompts
from input_safety import check_uploaded_text

log = logging.getLogger(__name__)

MIN_TEXT_CHARS = 20

TOOL_TITLES = {
    ("summary", None): ("学习重点总结", "重点总结器"),
    ("english", "rhetorical-analysis"): (
        "英语课助手 · Rhetorical Analysis（修辞分析）",
        "英语课助手",
    ),
}

ENGLISH_TITLED_BODY_TASKS = {"precis", "summary", "outline"}

_PUBLIC_FIELDS = (
    "id",
    "state",
    "step",
    "message",
    "progress",
    "pdf_url",
    "tex_url",
    "error",
    "created_at",
    "updated_at",
)

FINISHED_STATES = ("done", "error")


class JobManager:
    """队列 + 状态机 + 清理线程。"""

    def __init__(
        self,
        config: Dict[str, Any],
        guard,
        llm,
        tex_service,
        extractor: Optional[Callable[[Path, str, Dict[str, Any]], str]] = None,
        prompt_builder: Optional[Callable[..., Any]] = None,
    ) -> None:
        self.config = config
        self.guard = guard
        self.llm = llm
        self.tex = tex_service
        self.extractor = extractor or extract_text
        self.prompt_builder = prompt_builder or build_prompts

        self.jobs: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._queue: "queue.Queue[Optional[str]]" = queue.Queue(
            maxsize=int(config["queue_max_size"])
        )
        self._stop = threading.Event()
        self._workers = []
        self._cleanup_thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------ 生命周期
    def start(self) -> None:
        if self._workers:
            return
        for index in range(int(self.config["queue_concurrency"])):
            thread = threading.Thread(
                target=self._worker_loop,
                name=f"job-worker-{index + 1}",
                daemon=True,
            )
            thread.start()
            self._workers.append(thread)
        self._cleanup_thread = threading.Thread(
            target=self._cleanup_loop, name="artifact-cleaner", daemon=True
        )
        self._cleanup_thread.start()
        # 启动时先清一次，避免上次进程异常退出留下的过期产物占磁盘
        try:
            self.cleanup_once()
        except Exception:  # pragma: no cover - 清理失败不影响服务
            log.exception("启动清理失败")
        log.info(
            "作业队列已启动：并发 %d，队列上限 %d，产物保留 %d 秒",
            self.config["queue_concurrency"],
            self.config["queue_max_size"],
            self.config["artifact_ttl_seconds"],
        )

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        for _ in self._workers:
            try:
                self._queue.put_nowait(None)
            except queue.Full:  # pragma: no cover
                pass
        for thread in self._workers:
            thread.join(timeout=timeout)
        if self._cleanup_thread and self._cleanup_thread.is_alive():
            self._cleanup_thread.join(timeout=timeout)
        self._workers = []
        self._cleanup_thread = None

    # ------------------------------------------------------------------ 提交/查询
    def submit(self, job_id: str, work_dir: Path, ext: str, tool: str, task: Optional[str], ip: str) -> Dict[str, Any]:
        now = time.time()
        job = {
            "id": job_id,
            "state": "queued",
            "step": "排队中",
            "message": "已收到文件，正在排队处理…",
            "progress": 0.05,
            "pdf_url": None,
            "tex_url": None,
            "error": None,
            "created_at": now,
            "updated_at": now,
            "_work_dir": str(work_dir),
            "_ext": ext,
            "_tool": tool,
            "_task": task,
            "_ip_hash": hash_ip(ip),  # 只存脱敏哈希，作业对象不暴露给前端
        }
        with self._lock:
            self.jobs[job_id] = job

        try:
            self._queue.put_nowait(job_id)
        except queue.Full:
            with self._lock:
                self.jobs.pop(job_id, None)
            self.guard.remove_work_dir(job_id)
            raise ToolError(429, "服务器排队任务过多，请稍后再试")

        return self.get(job_id) or {}

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            return {key: job.get(key) for key in _PUBLIC_FIELDS}

    def queue_size(self) -> int:
        return self._queue.qsize()

    # ------------------------------------------------------------------ 状态更新
    def _ensure_job(self, job_id: str) -> Dict[str, Any]:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            return job

    def _update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if job is None:  # 已被清理
                return
            for key, value in fields.items():
                if key == "progress":
                    value = max(float(job.get("progress") or 0.0), float(value))
                job[key] = value
            job["updated_at"] = time.time()

    # ------------------------------------------------------------------ 执行
    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            try:
                job_id = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                if job_id is None:
                    break
                self._run_job(job_id)
            finally:
                self._queue.task_done()

    def process_one(self, timeout: Optional[float] = None) -> bool:
        """测试/调试用：同步消费一个作业。返回是否处理了作业。"""
        try:
            job_id = self._queue.get(timeout=timeout)
        except queue.Empty:
            return False
        try:
            if job_id is None:
                return False
            self._run_job(job_id)
            return True
        finally:
            self._queue.task_done()

    def _titles(self, tool: str, task: Optional[str]):
        if tool == "english" and task in ENGLISH_TITLED_BODY_TASKS:
            return "", "", ""
        key = (tool, task if tool == "english" else None)
        title, header = TOOL_TITLES.get(key, ("学习资料", "神秘工具箱"))
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        subtitle = f"由「{header}」根据上传文件自动生成 · {stamp} · 内容由 AI 生成，请自行核对"
        return title, subtitle, header

    def _run_job(self, job_id: str) -> None:
        try:
            job = dict(self._ensure_job(job_id))
        except KeyError:  # pragma: no cover - 已被清理
            return

        work_dir = Path(job["_work_dir"])
        ext = job["_ext"]
        tool = job["_tool"]
        task = job["_task"]

        try:
            # 1) 抽取文本 --------------------------------------------------
            self._update(
                job_id,
                state="extracting",
                step="抽取文本",
                message="正在从文件中提取文字…",
                progress=0.2,
            )
            input_path = work_dir / f"input.{ext}"
            text = self.extractor(input_path, ext, self.config)
            if len(text.strip()) < MIN_TEXT_CHARS:
                raise ToolError(
                    400,
                    f"从文件中提取到的文字太少（不足 {MIN_TEXT_CHARS} 字），"
                    "无法生成总结，请换一个内容更完整的文件",
                )

            # 2) 调大模型 --------------------------------------------------
            check_uploaded_text(text)

            llm_timeout = int(self.config["llm_timeout_seconds"])
            self._update(
                job_id,
                state="llm",
                step="调用大模型",
                message=f"正在调用 DeepSeek 生成内容（最多 {llm_timeout} 秒）…",
                progress=0.5,
            )
            system_prompt, user_prompt = self.prompt_builder(tool, task, text, self.config)
            effort = self.config.get("job_reasoning_effort")
            if effort:
                content = self.llm.complete(system_prompt, user_prompt, reasoning_effort=effort)
            else:
                content = self.llm.complete(system_prompt, user_prompt)
            if not content or not content.strip():
                raise ToolError(502, "大模型返回内容为空，请重试")

            # 3) 清洗 + 排版 + 编译 ---------------------------------------
            self._update(
                job_id,
                state="typesetting",
                step="排版编译",
                message="正在清洗内容、排版并编译 PDF…",
                progress=0.8,
            )
            body, removed = self.tex.sanitize(content)
            if removed:
                log.info("作业 %s 已过滤危险 LaTeX 命令：%s", job_id, ",".join(removed))
            if len(body.strip()) < 2:
                raise ToolError(500, "大模型返回的内容清洗后为空，请重试")

            title, subtitle, header = self._titles(tool, task)
            tex_source = self.tex.build_document(
                body, title, subtitle=subtitle, header=header
            )
            tex_work = work_dir / "main.tex"
            tex_work.write_text(tex_source, encoding="utf-8")

            pdf_url = None
            tex_path = self.guard.artifact_path(job_id, "tex")
            if bool(self.config.get("compile_pdf", True)):
                pdf_path = self.tex.compile(work_dir, "main.tex")
                shutil.copyfile(str(pdf_path), str(self.guard.artifact_path(job_id, "pdf")))
                pdf_url = f"/api/files/{job_id}.pdf"
                message = "生成成功，可以下载 PDF 了"
            else:  # 仅本地/测试环境：没有 TeX 时只产出 .tex
                log.warning("compile_pdf=false，作业 %s 跳过 PDF 编译，只输出 .tex", job_id)
                message = "已生成 LaTeX 源码（本机未启用 PDF 编译），可下载 .tex 文件"

            shutil.copyfile(str(tex_work), str(tex_path))

            self._update(
                job_id,
                state="done",
                step="完成",
                message=message,
                progress=1.0,
                pdf_url=pdf_url,
                tex_url=f"/api/files/{job_id}.tex",
                error=None,
            )
            log.info("作业 %s 完成（%s/%s，%d 字文本）", job_id, tool, task or "-", len(text))

        except ToolError as exc:
            self._fail(job_id, exc.message)
        except Exception as exc:  # noqa: BLE001 - 兜底，绝不把堆栈暴露给访客
            log.exception("作业 %s 内部错误", job_id)
            self._fail(job_id, "服务器内部错误，请稍后再试")
        finally:
            self.guard.remove_work_dir(job_id)

    def _fail(self, job_id: str, message: str) -> None:
        for ext in ("pdf", "tex"):
            try:
                path = self.guard.artifact_path(job_id, ext)
                if path.exists():
                    path.unlink()
            except (OSError, ToolError):
                pass
        self._update(
            job_id,
            state="error",
            step="失败",
            message=message,
            error=message,
            pdf_url=None,
            tex_url=None,
        )
        log.warning("作业 %s 失败：%s", job_id, message)

    # ------------------------------------------------------------------ 清理
    def _cleanup_loop(self) -> None:
        interval = max(30, int(self.config.get("cleanup_interval_seconds") or 300))
        while not self._stop.wait(interval):
            try:
                self.cleanup_once()
            except Exception:  # pragma: no cover - 清理失败不能影响主流程
                log.exception("清理线程异常")

    def cleanup_once(self, now: Optional[datetime] = None) -> Dict[str, int]:
        """清理过期产物、遗留目录和内存中的作业记录。"""
        now = now or datetime.now()
        removed = self.guard.cleanup(now)
        cutoff = now.timestamp() - int(self.config["artifact_ttl_seconds"])
        with self._lock:
            expired = [
                job_id
                for job_id, job in self.jobs.items()
                if job.get("state") in FINISHED_STATES
                and float(job.get("updated_at") or 0) < cutoff
            ]
            for job_id in expired:
                self.jobs.pop(job_id, None)
        if expired:
            log.info("清理过期作业记录 %d 个", len(expired))
        removed["jobs"] = len(expired)
        return removed
