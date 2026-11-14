"""提示词包：打包好的 system prompt + 运行时读取课程笔记。"""

from prompts.loader import build_prompts, load_system_prompt

__all__ = ["build_prompts", "load_system_prompt"]
