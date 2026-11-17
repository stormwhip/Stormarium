"""Detect common prompt injections in untrusted uploaded study materials."""

import re
import unicodedata
from errors import ToolError

RULES = (
    re.compile(r"(?:忽略|无视|覆盖|绕过|取代|跳过)[^\n。]{0,55}(?:指令|提示词|规则|系统消息|开发者消息)"),
    re.compile(r"(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|above|earlier|system|developer)[^\n.]{0,45}(?:instructions|prompts|rules)", re.I),
    re.compile(r"(?:泄露|透露|输出|展示|打印|发送)[^\n。]{0,35}(?:系统提示词|开发者提示词|密钥|api[\s_-]*key|system\s+prompt)", re.I),
    re.compile(r"<\s*/?\s*(?:system|developer|assistant|source_text)\s*>", re.I),
    re.compile(r"(?:\[im_start\]|<\|im_start\|>)\s*(?:system|developer|assistant)", re.I),
    re.compile(r"(?:you\s+are\s+now\s+(?:the\s+)?(?:system|developer)|从现在开始你是系统)", re.I),
)

def check_uploaded_text(source_text: str) -> None:
    text = unicodedata.normalize("NFKC", source_text)
    text = re.sub(r"[\u200b-\u200f\ufeff]", "", text)
    if any(rule.search(text) for rule in RULES):
        raise ToolError(400, "上传内容包含试图改变工具行为的指令，请移除相关段落后重试")
