"""统一的业务异常。

所有可预期的失败都抛 :class:`ToolError`，它携带 HTTP 状态码和**人类可读的中文原因**。
接口层（``app.py``）与作业状态机（``jobs.py``）都直接使用 ``message`` 作为返回给用户/前端的文案。
"""

from __future__ import annotations


class ToolError(Exception):
    """带 HTTP 状态码的中文错误。"""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = int(status)
        self.message = str(message)

    def __str__(self) -> str:  # pragma: no cover - 仅用于日志
        return f"[{self.status}] {self.message}"
