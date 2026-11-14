"""LaTeX 片段清洗 + 套模板 + 调用 xelatex（禁用 shell escape、超时杀进程组、限制内存）。

安全红线（契约 §5）：

* 编译命令固定带 ``-no-shell-escape``；
* 只编译服务端自己写的模板，模型返回的内容作为「正文片段」注入；
* 注入前过滤 ``\\write18`` / ``\\openout`` / ``\\openin`` / ``\\input`` / ``\\include`` /
  ``\\includegraphics`` / ``\\immediate\\write`` / ``\\newwrite`` / ``\\catcode`` /
  ``\\csname`` / ``\\directlua`` 等一切可能读写文件或执行命令的底层命令；
* 每个作业在独立临时目录编译，超时直接 kill 整个进程组（xelatex 会派生 xdvipdfmx）；
* POSIX 下给 xelatex 子进程设 ``RLIMIT_AS``（默认 900MB），防止 2GB 小内存机器被 TeX 打爆
  （契约 §9.4）。

模板（契约 §9.3）：服务器没有 ctex / texlive-lang-chinese，模板使用
``article + xeCJK + Noto CJK``，不使用 ctexart。
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import signal
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from errors import ToolError

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 危险命令：名称 -> 正则。按「命令 token」匹配，而不是整行，避免漏掉紧跟在后面的参数。
# 说明：即使 xelatex 已禁用 shell escape，这里仍然全部过滤（纵深防御）。
# ---------------------------------------------------------------------------
DANGEROUS_COMMANDS: List[Tuple[str, "re.Pattern[str]"]] = [
    ("write18", re.compile(r"\\write18")),
    ("write", re.compile(r"\\write(?![0-9A-Za-z])")),
    ("openout", re.compile(r"\\openout(?![A-Za-z])")),
    ("openin", re.compile(r"\\openin(?![A-Za-z])")),
    ("input", re.compile(r"\\input(?![A-Za-z])")),
    ("include", re.compile(r"\\include(?![A-Za-z])")),
    ("includegraphics", re.compile(r"\\includegraphics(?![A-Za-z])")),
    ("includepdf", re.compile(r"\\includepdf(?![A-Za-z])")),
    ("lstinputlisting", re.compile(r"\\lstinputlisting(?![A-Za-z])")),
    ("verbatiminput", re.compile(r"\\verbatiminput(?![A-Za-z])")),
    ("filecontents", re.compile(
        r"\\begin\s*\{\s*filecontents\*?\s*\}|\\end\s*\{\s*filecontents\*?\s*\}|\\filecontents\*?"
    )),
    ("at-input", re.compile(r"\\@+input(?![A-Za-z])|\\@+include(?![A-Za-z])")),
    ("at-writefile", re.compile(r"\\@writefile|\\protected@write|\\@starttoc")),
    ("makeatletter", re.compile(r"\\makeatletter|\\makeatother")),
    ("expl3-io", re.compile(
        r"\\ExplSyntaxOn|\\ExplSyntaxOff|\\[A-Za-z]*(?:iow|ior)_[A-Za-z]+"
    )),
    ("minted", re.compile(r"\\inputminted|\\minted(?![A-Za-z])")),
    ("import", re.compile(r"\\(?:sub)?import(?![A-Za-z])")),
    ("subfile", re.compile(r"\\subfile(?![A-Za-z])")),
    ("IfFileExists", re.compile(r"\\InputIfFileExists|\\IfFileExists")),
    ("usepackage", re.compile(r"\\usepackage(?![A-Za-z])")),
    ("RequirePackage", re.compile(r"\\RequirePackage(?![A-Za-z])")),
    ("documentclass", re.compile(r"\\documentclass(?![A-Za-z])")),
    ("begin-document", re.compile(r"\\begin\s*\{\s*document\s*\}")),
    ("end-document", re.compile(r"\\end\s*\{\s*document\s*\}")),
    ("immediate", re.compile(r"\\immediate(?![A-Za-z])")),
    ("newwrite", re.compile(r"\\newwrite(?![A-Za-z])")),
    ("newread", re.compile(r"\\newread(?![A-Za-z])")),
    ("catcode", re.compile(r"\\catcode(?![A-Za-z])")),
    ("read", re.compile(r"\\read(?![A-Za-z])")),
    ("csname", re.compile(r"\\csname(?![A-Za-z])")),
    ("special", re.compile(r"\\special(?![A-Za-z])")),
    ("shellescape", re.compile(r"\\ShellEscape|\\shellescape")),
    ("directlua", re.compile(r"\\directlua|\\latelua|\\luaexec(?![A-Za-z])")),
    ("pdf-primitive", re.compile(r"\\pdf[a-zA-Z]+")),
    ("shipout", re.compile(r"\\shipout(?![A-Za-z])")),
    ("output", re.compile(r"\\output(?![A-Za-z])")),
    ("everyjob", re.compile(r"\\everyjob(?![A-Za-z])")),
    ("everypar", re.compile(r"\\everypar(?![A-Za-z])")),
    ("toks", re.compile(r"\\toks(?![A-Za-z])")),
]

_ESCAPE_MAP = {
    "\\": r"\textbackslash{}",
    "&": r"\&",
    "%": r"\%",
    "$": r"\$",
    "#": r"\#",
    "_": r"\_",
    "{": r"\{",
    "}": r"\}",
    "~": r"\textasciitilde{}",
    "^": r"\textasciicircum{}",
}

_TEMPLATE_TOKEN_RE = re.compile(r"@@[A-Z_]+@@")


def escape_latex(text: str) -> str:
    """转义纯文本（只用于服务端自己生成的标题等，不用于模型片段）。"""
    return "".join(_ESCAPE_MAP.get(ch, ch) for ch in str(text))


def sanitize_latex(fragment: str) -> Tuple[str, List[str]]:
    """删除危险命令，返回 ``(干净片段, 被删除的命令名列表)``。

    反复替换直到稳定，防止 ``\\open\\openoutout`` 这类拼接在删除一次后重新组合出危险命令。
    """
    text = str(fragment or "")
    removed: List[str] = []
    for _ in range(8):
        changed = False
        for name, pattern in DANGEROUS_COMMANDS:
            new_text, count = pattern.subn("", text)
            if count:
                changed = True
                removed.extend([name] * count)
                text = new_text
        if not changed:
            break
    # 去空字节和残留的孤立控制字符
    text = text.replace("\x00", "")
    text = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", "", text)
    # 去重并保持首次出现顺序
    seen = set()
    unique_removed = []
    for name in removed:
        if name not in seen:
            seen.add(name)
            unique_removed.append(name)
    return text.strip(), unique_removed


# ---------------------------------------------------------------------------
# 轻量 Markdown 兜底：模型偶尔会忘记「只输出 LaTeX」，这里把常见的 Markdown
# 结构转成合法 LaTeX，避免整份文档编译失败。
# ---------------------------------------------------------------------------
_FENCE_RE = re.compile(r"```[ \t]*([A-Za-z0-9_+-]*)[ \t]*\n(.*?)```", re.DOTALL)
_HEADING_RE = re.compile(r"(?m)^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_BOLD_RE = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"(?<!`)`([^`\n]+)`(?!`)")


def _fence_replacement(match: "re.Match[str]") -> str:
    lang = (match.group(1) or "").lower()
    code = match.group(2).rstrip()
    if lang in ("", "latex", "tex"):
        return code
    return "\\begin{lstlisting}\n" + code + "\n\\end{lstlisting}"


def _heading_replacement(match: "re.Match[str]") -> str:
    level = len(match.group(1))
    title = match.group(2).strip()
    if not title:
        return ""
    command = {1: "section", 2: "section", 3: "subsection"}.get(level, "subsubsection")
    return f"\\{command}*{{{title}}}"


def normalize_markup(fragment: str) -> str:
    """把整份文档/代码围栏/标题/粗体/行内代码等 Markdown 残留转成 LaTeX。"""
    text = str(fragment or "").replace("\ufeff", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # 若模型直接返回了完整文档，只取正文
    body_match = re.search(
        r"\\begin\s*\{\s*document\s*\}(.*?)\\end\s*\{\s*document\s*\}",
        text,
        re.DOTALL,
    )
    if body_match:
        text = body_match.group(1)

    text = _FENCE_RE.sub(_fence_replacement, text)
    text = _HEADING_RE.sub(_heading_replacement, text)
    text = _BOLD_RE.sub(lambda m: "\\textbf{" + m.group(1) + "}", text)
    text = _INLINE_CODE_RE.sub(
        lambda m: "\\texttt{" + escape_latex(m.group(1)) + "}", text
    )
    # 去掉落单的围栏行
    text = re.sub(r"(?m)^[ \t]*```.*$", "", text)
    return text.strip()


# ---------------------------------------------------------------------------
# 编译日志 -> 中文错误
# ---------------------------------------------------------------------------
_REASON_MAP = (
    ("undefined control sequence", "命令未定义"),
    ("missing $ inserted", "数学模式符号 $ 不匹配"),
    ("missing number", "命令缺少必要参数"),
    ("missing \\begin{document}", "缺少 \\begin{document}"),
    ("extra alignment tab", "表格列数超出"),
    ("misplaced alignment tab", "表格 & 位置错误"),
    ("not found", "依赖文件缺失"),
    ("font", "字体缺失或无法加载"),
    ("tex capacity exceeded", "文档过大，超出 TeX 容量"),
    ("emergency stop", "编译被中止"),
    ("fatal error", "致命错误"),
)


def describe_tex_error(log_text: str, max_len: int = 200) -> str:
    """把 xelatex 日志提炼成一句中文原因（契约要求可读）。"""
    log_text = str(log_text or "")
    line_no: Optional[int] = None
    command: Optional[str] = None
    message = ""

    match = re.search(r"[\w.\-]+\.tex:(\d+):\s*(.+)", log_text)
    if match:
        line_no = int(match.group(1))
        message = match.group(2).strip()
    if not message:
        bang = re.search(r"(?m)^!\s*(.+)$", log_text)
        if bang:
            message = bang.group(1).strip()
    line_match = re.search(r"(?m)^l\.(\d+)\s+(\S+)", log_text)
    if line_match:
        if line_no is None:
            line_no = int(line_match.group(1))
        command = line_match.group(2)

    reason = ""
    lowered = message.lower()
    for needle, chinese in _REASON_MAP:
        if needle in lowered:
            reason = chinese
            break
    if not reason:
        reason = message or "未知错误"

    parts = ["LaTeX 编译失败"]
    if line_no is not None:
        parts.append(f"第 {line_no} 行")
    if command:
        parts.append(command)
    result = "：".join([parts[0], " ".join(parts[1:])]) if len(parts) > 1 else parts[0]
    result = result.rstrip() + " " + reason
    return result[:max_len]


# ---------------------------------------------------------------------------
# 模板与编译
# ---------------------------------------------------------------------------
class LatexService:
    """读模板、套片段、调 xelatex。"""

    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.templates_dir = Path(config["templates_dir"])
        self.template_path = self.templates_dir / "article.tex"
        self.timeout = int(config.get("tex_timeout_seconds") or 60)
        self.memory_limit_bytes = int(config.get("tex_memory_limit_mb") or 0) * 1024 * 1024
        self._data_dir = Path(config["data_dir"])

    # ------------------------------------------------------------------ 环境
    def find_xelatex(self) -> str:
        configured = str(self.config.get("xelatex_path") or "").strip()
        if configured:
            return configured if Path(configured).is_file() else ""
        return shutil.which("xelatex") or ""

    def available(self) -> bool:
        return bool(self.find_xelatex()) and self.template_path.is_file()

    # ------------------------------------------------------------------ 清洗
    def sanitize(self, fragment: str) -> Tuple[str, List[str]]:
        """把模型输出规整成安全可编译的 LaTeX 正文片段。"""
        return sanitize_latex(normalize_markup(fragment))

    # ------------------------------------------------------------------ 模板
    def load_template(self) -> str:
        try:
            return self.template_path.read_text(encoding="utf-8")
        except OSError as exc:
            log.error("读取 LaTeX 模板失败 %s：%s", self.template_path, exc)
            raise ToolError(500, "服务器缺少 LaTeX 模板文件，无法生成 PDF") from exc

    def build_document(
        self,
        body: str,
        title: str,
        subtitle: str = "",
        header: str = "",
        generated_at: Optional[str] = None,
    ) -> str:
        template = self.load_template()
        if "@@BODY@@" not in template:
            raise ToolError(500, "LaTeX 模板损坏（缺少 @@BODY@@ 占位符）")

        generated_at = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M")
        # 注意：token 用简单字符串替换，避免 LaTeX 花括号与 format/Jinja 冲突。
        document = (
            template.replace("@@TITLE@@", escape_latex(title))
            .replace("@@SUBTITLE@@", escape_latex(subtitle))
            .replace("@@HEADER@@", escape_latex(header or title))
            .replace("@@GENERATED_AT@@", escape_latex(generated_at))
            .replace("@@BODY@@", body)
        )
        leftover = _TEMPLATE_TOKEN_RE.search(document)
        if leftover:
            raise ToolError(500, f"LaTeX 模板占位符未替换：{leftover.group(0)}")
        return document

    # ------------------------------------------------------------------ 编译
    def build_command(self, xelatex: str, tex_filename: str = "main.tex") -> List[str]:
        """固定带 -no-shell-escape 的编译命令。"""
        return [
            xelatex,
            "-no-shell-escape",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            tex_filename,
        ]

    def _child_env(self) -> Dict[str, str]:
        env = dict(os.environ)
        if os.name != "nt":
            texmf = self._data_dir / "texmf-var"
            try:
                texmf.mkdir(parents=True, exist_ok=True)
            except OSError:
                pass
            env.setdefault("TEXMFVAR", str(texmf))
            env.setdefault("TEXMFCACHE", str(texmf))
            env.setdefault("HOME", str(self._data_dir))
        env["SOURCE_DATE_EPOCH"] = "1700000000"
        return env

    def _kill_tree(self, process: "subprocess.Popen[bytes]") -> None:
        """超时后杀整个进程组（xelatex 会 fork 子进程）。"""
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (OSError, ProcessLookupError):
            pass
        try:
            process.kill()
        except OSError:
            pass

    def _apply_memory_limit(self) -> None:
        """子进程 fork 后、exec 前设置虚拟内存上限（POSIX）。"""
        if self.memory_limit_bytes <= 0:
            return
        try:
            import resource
        except ImportError:  # pragma: no cover - 非 POSIX
            return
        try:
            resource.setrlimit(
                resource.RLIMIT_AS,
                (self.memory_limit_bytes, self.memory_limit_bytes),
            )
        except (ValueError, OSError):  # pragma: no cover - 受限环境
            pass

    def _run_with_timeout(
        self, command: List[str], cwd: Path, timeout: float
    ) -> Tuple[int, str]:
        """执行命令；超时杀进程组并抛中文 ToolError。"""
        kwargs: Dict[str, Any] = {
            "cwd": str(cwd),
            "stdin": subprocess.DEVNULL,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.STDOUT,
            "env": self._child_env(),
        }
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        else:
            # 新进程组 + 与 xelatex 进程组一起 kill；内存上限限制 xelatex/xdvipdfmx
            kwargs["start_new_session"] = True
            if self.memory_limit_bytes > 0:
                kwargs["preexec_fn"] = self._apply_memory_limit

        try:
            process = subprocess.Popen(command, **kwargs)
        except FileNotFoundError as exc:
            raise ToolError(
                500,
                "服务器未安装 xelatex，无法编译 PDF（请安装 texlive-xetex）",
            ) from exc
        except OSError as exc:
            log.error("启动 xelatex 失败：%s", exc)
            raise ToolError(500, "无法启动 LaTeX 编译器，请联系站长") from exc

        try:
            output, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            self._kill_tree(process)
            try:
                process.communicate(timeout=5)
            except Exception:  # pragma: no cover - 进程已被强杀
                pass
            log.warning("LaTeX 编译超时（%.0f 秒），已 kill 进程组", timeout)
            raise ToolError(504, f"LaTeX 编译超时（超过 {timeout:.0f} 秒），已终止，请重试")

        text = (output or b"").decode("utf-8", errors="replace")
        return int(process.returncode if process.returncode is not None else -1), text

    def compile(self, work_dir: Path, tex_filename: str = "main.tex") -> Path:
        """在 ``work_dir`` 里编译 ``tex_filename``，返回生成的 PDF 路径。"""
        xelatex = self.find_xelatex()
        if not xelatex:
            raise ToolError(
                500,
                "服务器未安装 xelatex，无法编译 PDF（请安装 texlive-xetex）",
            )

        work_dir = Path(work_dir)
        command = self.build_command(xelatex, tex_filename)
        try:
            returncode, output = self._run_with_timeout(command, work_dir, self.timeout)
        except ToolError:
            raise
        except Exception as exc:  # pragma: no cover - 防御
            log.exception("调用 xelatex 异常")
            raise ToolError(500, "LaTeX 编译器运行异常，请稍后再试") from exc

        pdf_path = work_dir / (Path(tex_filename).stem + ".pdf")
        if returncode != 0 or not pdf_path.is_file() or pdf_path.stat().st_size == 0:
            log_path = work_dir / (Path(tex_filename).stem + ".log")
            try:
                log_text = log_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                log_text = output
            log.warning("LaTeX 编译失败（exit=%s）：%s", returncode, describe_tex_error(log_text))
            raise ToolError(500, describe_tex_error(log_text))
        return pdf_path
