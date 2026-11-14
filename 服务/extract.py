"""文本抽取：PDF / PPTX / DOCX / TXT / 图片(OCR)。

对应契约 §3.1。所有依赖都在函数内部才 import：服务器上某个组件缺失时，
只有对应类型的文件会失败，不会拖垮整个服务；错误文案会明确告诉访客缺了什么。

注意：本模块只负责「把文件变成文字」，不写任何产物；作业目录由 :mod:`guard` 管理。
"""

from __future__ import annotations

import logging
import re
from codecs import BOM_UTF16_BE, BOM_UTF16_LE, BOM_UTF8
from pathlib import Path
from typing import Any, Dict

from errors import ToolError

log = logging.getLogger(__name__)

_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_BLANK_RE = re.compile(r"\n{4,}")

MAX_PDF_PAGES = 80
MAX_PPTX_SLIDES = 120
TRUNCATE_MARKER = "\n\n[注意：原文过长，已截断，仅保留前面的内容供总结使用]"


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CTRL_RE.sub("", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return _BLANK_RE.sub("\n\n\n", text).strip()


def extract_text(path: Path, ext: str, config: Dict[str, Any]) -> str:
    """按扩展名分派抽取，返回清洗后的纯文本（可能为空字符串）。"""
    ext = str(ext).lower().lstrip(".")
    path = Path(path)
    if not path.is_file():
        raise ToolError(500, "服务器内部错误：找不到上传的临时文件，请重新上传")

    if ext == "pdf":
        text = _extract_pdf(path, config)
    elif ext == "pptx":
        text = _extract_pptx(path)
    elif ext == "docx":
        text = _extract_docx(path)
    elif ext == "txt":
        text = _extract_txt(path)
    elif ext in ("png", "jpg", "jpeg", "webp"):
        text = _extract_image(path, config)
    else:  # pragma: no cover - 上层已按白名单拦截
        raise ToolError(400, f"不支持的文件类型：.{ext}")

    text = _normalize(text)
    limit = int(config.get("max_input_chars") or 0)
    if limit > 0 and len(text) > limit:
        text = text[:limit].rstrip() + TRUNCATE_MARKER
    return text


def _extract_txt(path: Path) -> str:
    data = path.read_bytes()
    if data.startswith((BOM_UTF16_LE, BOM_UTF16_BE)):
        encodings = ("utf-16",)
    elif data.startswith(BOM_UTF8):
        encodings = ("utf-8-sig",)
    else:
        encodings = ("utf-8", "gb18030")

    for encoding in encodings:
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "\x00" not in text:
            return text
        break

    raise ToolError(400, "无法读取 TXT 文件，请将纯文本另存为 UTF-8 编码后重新上传")


# --------------------------------------------------------------------- PDF
def _extract_pdf(path: Path, config: Dict[str, Any]) -> str:
    try:
        import pdfplumber
    except ImportError as exc:  # pragma: no cover - 部署时 requirements 会装
        raise ToolError(500, "服务器缺少 pdfplumber，暂时无法读取 PDF") from exc

    parts = []
    max_pages = int(config.get("max_pdf_pages") or MAX_PDF_PAGES)
    try:
        with pdfplumber.open(str(path)) as pdf:
            if pdf.pages and len(pdf.pages) > max_pages:
                log.info("PDF 共 %d 页，只抽取前 %d 页", len(pdf.pages), max_pages)
            for index, page in enumerate(pdf.pages):
                if index >= max_pages:
                    break
                try:
                    page_text = page.extract_text() or ""
                except Exception:  # 单页失败不拖垮整份文件
                    page_text = ""
                if page_text:
                    parts.append(page_text)
    except ToolError:
        raise
    except Exception as exc:
        log.info("解析 PDF 失败：%s", exc)
        raise ToolError(
            400,
            "无法解析 PDF 文件，可能已损坏或设置了密码保护，请换一个文件",
        ) from exc
    return "\n\n".join(parts)


# -------------------------------------------------------------------- PPTX
def _extract_pptx(path: Path) -> str:
    try:
        from pptx import Presentation
        from pptx.enum.shapes import MSO_SHAPE_TYPE
    except ImportError as exc:  # pragma: no cover
        raise ToolError(500, "服务器缺少 python-pptx，暂时无法读取 PPTX") from exc

    parts = []

    def walk(shapes):
        for shape in shapes:
            shape_type = getattr(shape, "shape_type", None)
            if shape_type == MSO_SHAPE_TYPE.GROUP:
                walk(shape.shapes)
                continue
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        parts.append(" | ".join(cells))
                continue
            if getattr(shape, "has_text_frame", False):
                text = shape.text_frame.text.strip()
                if text:
                    parts.append(text)

    try:
        presentation = Presentation(str(path))
        for index, slide in enumerate(presentation.slides):
            if index >= MAX_PPTX_SLIDES:
                break
            walk(slide.shapes)
            try:
                if slide.has_notes_slide:
                    notes = slide.notes_slide.notes_text_frame.text.strip()
                    if notes:
                        parts.append(notes)
            except Exception:
                pass
    except Exception as exc:
        log.info("解析 PPTX 失败：%s", exc)
        raise ToolError(
            400,
            "无法解析 PPTX 文件，可能已损坏（仅支持 .pptx，不支持旧版 .ppt）",
        ) from exc
    return "\n\n".join(parts)


# -------------------------------------------------------------------- DOCX
def _extract_docx(path: Path) -> str:
    try:
        import docx
    except ImportError as exc:  # pragma: no cover
        raise ToolError(500, "服务器缺少 python-docx，暂时无法读取 DOCX") from exc

    parts = []
    try:
        document = docx.Document(str(path))
        for paragraph in document.paragraphs:
            text = paragraph.text.strip()
            if text:
                parts.append(text)
        for table in document.tables:
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                if any(cells):
                    parts.append(" | ".join(cells))
    except Exception as exc:
        log.info("解析 DOCX 失败：%s", exc)
        raise ToolError(
            400,
            "无法解析 DOCX 文件，可能已损坏（仅支持 .docx；旧版 .doc 请先另存为 .docx）",
        ) from exc
    return "\n\n".join(parts)


# --------------------------------------------------------------------- 图片
def _extract_image(path: Path, config: Dict[str, Any]) -> str:
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover
        raise ToolError(500, "服务器缺少 Pillow，暂时无法读取图片") from exc

    try:
        with Image.open(str(path)) as image:
            image.load()
            rgb = image.convert("RGB")
    except Exception as exc:
        log.info("打开图片失败：%s", exc)
        raise ToolError(
            400,
            "无法识别图片内容，请确认文件没有损坏（支持 png / jpg / jpeg / webp）",
        ) from exc

    try:
        import pytesseract
    except ImportError as exc:  # pragma: no cover
        raise ToolError(
            500,
            "服务器缺少 OCR 组件（pytesseract），暂时无法识别图片，请上传 PDF/DOCX/PPTX",
        ) from exc

    lang = str(config.get("ocr_lang") or "chi_sim+eng")
    try:
        return pytesseract.image_to_string(rgb, lang=lang) or ""
    except pytesseract.TesseractNotFoundError as exc:
        raise ToolError(
            500,
            "服务器缺少 OCR 组件（tesseract-ocr），暂时无法识别图片，请上传 PDF/DOCX/PPTX",
        ) from exc
    except Exception as exc:
        log.info("OCR 失败：%s", exc)
        raise ToolError(
            500,
            "图片文字识别失败，请换一张更清晰的图片，或上传 PDF/DOCX/PPTX",
        ) from exc
