"""DeepSeek 调用（OpenAI 兼容 ``POST {base_url}/chat/completions``）。

* 默认模型 ``deepseek-chat``，默认地址 ``https://api.deepseek.com``（契约 §0）。
* 单作业超时由契约 §4 规定为 120 秒（config: ``llm_timeout_seconds``）。
* Key 只从配置/环境变量来，本模块不写日志、不打印 key，也不存在任何默认 key。
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional

import requests
from urllib.parse import urlsplit

from errors import ToolError

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-chat"


def _http_error_message(status_code: int) -> str:
    if status_code == 400:
        return "大模型接口返回 400（请求格式错误），请稍后再试"
    if status_code == 401:
        return "大模型接口返回 401，请检查 key"
    if status_code == 402:
        return "大模型接口返回 402，账户余额不足，请联系站长"
    if status_code == 403:
        return "大模型接口返回 403，key 没有访问该模型的权限"
    if status_code == 429:
        return "大模型接口返回 429（请求太频繁），请稍后再试"
    if status_code >= 500:
        return f"大模型接口返回 {status_code}，服务端繁忙，请稍后再试"
    return f"大模型接口返回 {status_code}，请稍后再试"


class DeepSeekClient:
    """最小可用的 DeepSeek chat/completions 客户端。"""

    def __init__(self, config: Dict[str, Any], session: Optional[requests.Session] = None) -> None:
        self.config = config
        self.api_key = str(config.get("deepseek_api_key") or "").strip()
        self.base_url = str(config.get("base_url") or DEFAULT_BASE_URL).rstrip("/")
        self.model = str(config.get("model") or DEFAULT_MODEL)
        self.timeout = int(config.get("llm_timeout_seconds") or 120)
        self.temperature = float(config.get("temperature") if config.get("temperature") is not None else 0.2)
        self.max_tokens = int(config.get("max_tokens") or 4096)
        self._session = session or requests.Session()
        if session is None:
            self._session.trust_env = False

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def complete(
        self,
        system: str,
        user: str,
        timeout: Optional[int] = None,
        *,
        reasoning_effort: Optional[str] = None,
    ) -> str:
        """调用模型并返回纯文本内容；所有失败都转成中文 :class:`ToolError`。"""
        if not self.api_key:
            raise ToolError(
                500,
                "服务端未配置 DeepSeek API Key，请联系站长（config.json 的 deepseek_api_key）",
            )

        read_timeout = int(timeout or self.timeout)
        parsed = urlsplit(self.base_url)
        allowed = self.config.get("allowed_provider_hosts", ["api.deepseek.com"])
        if (parsed.scheme != "https" or parsed.hostname not in allowed
                or parsed.port not in (None, 443) or parsed.username or parsed.password
                or parsed.query or parsed.fragment):
            raise ToolError(500, "模型服务配置无效")
        url = f"{self.base_url}/chat/completions"
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        if reasoning_effort:
            if self.model in ("deepseek-chat", "deepseek-reasoner"):
                payload["model"] = "deepseek-flash"
            payload["thinking"] = {"type": "enabled"}
            payload["reasoning_effort"] = reasoning_effort
            # DeepSeek counts reasoning and the final answer in the same output budget.
            payload["max_tokens"] = max(self.max_tokens, 16384)
            del payload["temperature"]
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "storm-tools/1.0",
        }

        started = time.monotonic()
        log.info(
            "调用 DeepSeek：model=%s，reasoning_effort=%s，prompt %d 字，超时 %d 秒",
            payload["model"],
            reasoning_effort or "default",
            len(system) + len(user),
            read_timeout,
        )
        try:
            response = self._session.post(
                url,
                json=payload,
                headers=headers,
                timeout=(10, read_timeout),
                allow_redirects=False,
            )
        except requests.Timeout as exc:
            raise ToolError(504, f"大模型调用超时（超过 {read_timeout} 秒），请稍后再试") from exc
        except requests.RequestException as exc:
            log.warning("连接 DeepSeek 失败：%s", exc)
            raise ToolError(502, "无法连接模型服务，请稍后重试") from exc

        elapsed = time.monotonic() - started
        log.info("DeepSeek 返回 HTTP %s，耗时 %.1f 秒", response.status_code, elapsed)

        if response.status_code != 200:
            raise ToolError(502, _http_error_message(int(response.status_code)))

        try:
            data = response.json()
        except ValueError as exc:
            raise ToolError(502, "大模型接口返回了无法解析的内容（不是 JSON）") from exc

        try:
            choice = data["choices"][0]
            content = choice["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ToolError(502, "大模型返回的数据结构异常（缺少 choices/message）") from exc

        if reasoning_effort and choice.get("finish_reason") == "length":
            raise ToolError(502, "DeepSeek 的思考与回答达到长度上限，请缩短材料后重试")

        content = (content or "").strip()
        if not content:
            raise ToolError(502, "大模型返回内容为空，请重试")

        # 截断说明输出撞到 max_tokens 上限：内容会缺尾巴（常见表现是 LaTeX 环境没闭合）。
        # 不在这里失败（还能编译出一份不完整但可读的文档），但要留下可排查的日志。
        if choice.get("finish_reason") == "length":
            log.warning(
                "大模型输出达到 max_tokens=%d 被截断，内容可能不完整", payload["max_tokens"]
            )
        return content
