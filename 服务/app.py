"""Flask 应用：实现契约 §3.2 的接口。

只监听 ``127.0.0.1:5000``（由 nginx 反代 ``/api/``），不提供任何静态页面，
前端是纯静态的 ``工具/*.html``，页面里不含任何 API Key。

接口：

* ``GET  /api/health``           健康检查（含 xelatex 是否可用）
* ``POST /api/jobs``             multipart: file / tool / task → ``{"id": "<uuid>"}``
* ``GET  /api/jobs/<id>``        作业状态（前端 1.5 秒轮询）
* ``GET  /api/files/<id>.pdf``   下载成品 PDF
* ``GET  /api/files/<id>.tex``   下载 LaTeX 源码（可选留档）
"""

from __future__ import annotations

import ipaddress
import logging
import re
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, jsonify, request, send_file
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

import config as config_module
from errors import ToolError
from guard import Guard, hash_ip
from jobs import JobManager
from llm import DeepSeekClient
from prompts.loader import PROMPT_FILES
from upload_safety import validate_upload
from tex import LatexService

log = logging.getLogger(__name__)

FILE_NAME_RE = re.compile(r"^([0-9a-f]{32})\.(pdf|tex)$")
MIMETYPES = {"pdf": "application/pdf", "tex": "text/plain; charset=utf-8"}


def _json_error(status: int, message: str):
    return jsonify({"error": message}), status


def _guess_client_ip(config: Dict[str, Any]) -> str:
    """取真实访客 IP。

    只信任本机（nginx）转发来的 ``X-Real-IP`` / ``X-Forwarded-For``；
    如果服务被错误地暴露到公网，伪造头也不会被采纳。
    """
    remote = (request.remote_addr or "").strip()
    candidates = []
    if config.get("trust_proxy") and remote in ("127.0.0.1", "::1", "localhost"):
        real_ip = (request.headers.get("X-Real-IP") or "").strip()
        if real_ip:
            candidates.append(real_ip)
    candidates.append(remote)
    for candidate in candidates:
        try:
            ipaddress.ip_address(candidate)
            return candidate
        except ValueError:
            continue
    return remote or "unknown"


def create_app(
    config: Optional[Dict[str, Any]] = None,
    llm: Any = None,
    tex_service: Any = None,
    extractor: Any = None,
    prompt_builder: Any = None,
) -> Flask:
    """创建 Flask 应用。参数可注入，便于单元测试（不真实调 DeepSeek / xelatex）。"""
    cfg = config_module.build_config(config) if config is not None else config_module.load_config()

    guard = Guard(cfg)
    if llm is None:
        llm = DeepSeekClient(cfg)
    if tex_service is None:
        tex_service = LatexService(cfg)

    manager = JobManager(
        cfg,
        guard,
        llm,
        tex_service,
        extractor=extractor,
        prompt_builder=prompt_builder,
    )

    app = Flask(__name__, static_folder=None, template_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = int(cfg["max_file_mb"]) * 1024 * 1024 + 256 * 1024
    app.config["JSON_AS_ASCII"] = False
    try:  # Flask >= 2.3
        app.json.ensure_ascii = False
    except Exception:  # pragma: no cover - 老版本 Flask
        pass
    app.extensions["storm_tools"] = {
        "config": cfg,
        "guard": guard,
        "manager": manager,
        "llm": llm,
        "tex": tex_service,
    }

    # ------------------------------------------------------------ 全局开关
    @app.before_request
    def _check_enabled():  # noqa: ANN202
        if not request.path.startswith("/api/"):
            return None
        if not guard.enabled:
            return _json_error(503, "工具暂时不可用，请稍后再试")
        ip = _guess_client_ip(cfg)
        guard.check_request_rate(
            ip, "upload" if request.path == "/api/jobs" and request.method == "POST" else "read"
        )
        if request.path == "/api/jobs" and request.method == "POST":
            origin = request.headers.get("Origin", "").strip().lower()
            site = request.headers.get("Sec-Fetch-Site", "").strip().lower()
            if origin not in cfg["allowed_origins"] or site == "cross-site":
                return _json_error(403, "请通过本站的工具页面上传文件")
            if not (request.content_type or "").lower().startswith("multipart/form-data"):
                return _json_error(415, "仅支持文件上传请求")
            guard.check_daily(ip)
        return None

    @app.after_request
    def _security_headers(response):  # noqa: ANN202
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
        return response

    # ------------------------------------------------------------ 健康检查
    @app.route("/api/health", methods=["GET"])
    def health():  # noqa: ANN202
        return jsonify({"ok": True})

    # ------------------------------------------------------------ 创建作业
    @app.route("/api/jobs", methods=["POST"])
    def create_job():  # noqa: ANN202
        upload = request.files.get("file")
        if upload is None or not (upload.filename or "").strip():
            raise ToolError(400, "请选择要上传的文件")

        tool = (request.form.get("tool") or "").strip().lower()
        if tool not in ("summary", "english"):
            raise ToolError(
                400, "tool 参数必须是 summary（重点总结）或 english（英语课助手）"
            )

        task = None
        if tool == "english":
            task = (request.form.get("task") or "").strip().lower()
            if (tool, task) not in PROMPT_FILES:
                raise ToolError(
                    400,
                    "英语课助手需要选择任务：precis、rhetorical-analysis、summary 或 outline",
                )

        # 扩展名白名单（大小由 MAX_CONTENT_LENGTH + save_upload 双重限制）
        ext = guard.check_upload(upload.filename)
        ip = _guess_client_ip(cfg)

        job_id = guard.new_job_id()
        work_dir = guard.work_dir(job_id)
        try:
            size = guard.save_upload(upload, work_dir / f"input.{ext}")
            validate_upload(
                work_dir / f"input.{ext}",
                ext,
                max_office_uncompressed=int(cfg["max_office_uncompressed_mb"]) * 1024 * 1024,
                max_image_pixels=int(cfg["max_image_pixels"]),
            )
            log.info(
                "收到上传：job=%s tool=%s task=%s ext=%s size=%d ip=%s",
                job_id,
                tool,
                task or "-",
                ext,
                size,
                hash_ip(ip),
            )
            guard.reserve_daily(ip)
            manager.submit(job_id, work_dir, ext, tool, task, ip)
        except Exception:
            guard.remove_work_dir(job_id)
            raise

        return jsonify({"id": job_id})

    # ------------------------------------------------------------ 查询作业
    @app.route("/api/jobs/<job_id>", methods=["GET"])
    def get_job(job_id: str):  # noqa: ANN202
        job_id = guard.require_job_id(job_id)
        job = manager.get(job_id)
        if job is None:
            raise ToolError(404, "作业不存在或已过期（产物保留 2 小时）")
        return jsonify(job)

    # ------------------------------------------------------------ 下载产物
    @app.route("/api/files/<filename>", methods=["GET"])
    def download(filename: str):  # noqa: ANN202
        match = FILE_NAME_RE.match((filename or "").lower())
        if not match:
            raise ToolError(404, "文件不存在或链接不正确")
        job_id, ext = match.group(1), match.group(2)
        path = guard.artifact_path(job_id, ext)
        if not path.is_file():
            raise ToolError(404, "文件不存在或已过期（产物保留 2 小时）")
        return send_file(
            str(path),
            mimetype=MIMETYPES[ext],
            as_attachment=True,
            download_name=f"storm-{ext}-{job_id[:8]}.{ext}",
            max_age=0,
            conditional=True,
        )

    # ------------------------------------------------------------ 错误处理
    @app.errorhandler(ToolError)
    def _handle_tool_error(exc: ToolError):  # noqa: ANN202
        return _json_error(exc.status, exc.message)

    @app.errorhandler(RequestEntityTooLarge)
    def _handle_too_large(_exc):  # noqa: ANN202
        return _json_error(413, f"文件超过 {cfg['max_file_mb']}MB")

    @app.errorhandler(HTTPException)
    def _handle_http_error(exc: HTTPException):  # noqa: ANN202
        messages = {
            400: "请求参数不正确",
            401: "未授权",
            403: "禁止访问",
            404: "接口不存在",
            405: "请求方法不允许",
            413: f"文件超过 {cfg['max_file_mb']}MB",
            415: "不支持的上传格式",
            429: "请求太频繁，请稍后再试",
        }
        status = exc.code or 500
        return _json_error(status, messages.get(status, "请求失败，请稍后再试"))

    @app.errorhandler(Exception)
    def _handle_unexpected(exc: Exception):  # noqa: ANN202
        log.exception("未处理异常：%s", exc)
        return _json_error(500, "服务器内部错误，请稍后再试")

    if cfg.get("start_workers", True):
        manager.start()

    return app


def _serve(app: Flask, config: Dict[str, Any]) -> None:
    host = str(config["host"])
    port = int(config["port"])
    try:
        from waitress import serve as waitress_serve
    except ImportError:  # pragma: no cover - 正常部署会装 waitress
        log.warning("未安装 waitress，退回 Flask 内置服务器（不建议生产使用）")
        app.run(host=host, port=port, debug=False, threaded=True)
        return

    log.info("waitress 启动：http://%s:%s（仅本机，由 nginx 反代 /api/）", host, port)
    waitress_serve(
        app,
        host=host,
        port=port,
        threads=4,
        channel_timeout=300,
        ident="storm-tools",
    )


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


if __name__ == "__main__":
    configure_logging()
    service_config = config_module.load_config()
    application = create_app(service_config)
    job_manager = application.extensions["storm_tools"]["manager"]
    try:
        _serve(application, service_config)
    finally:
        job_manager.stop()
