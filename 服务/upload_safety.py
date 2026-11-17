"""Bound uploaded input complexity before parsers or model calls are invoked."""

from __future__ import annotations

import warnings
import zipfile
from pathlib import Path, PurePosixPath

from errors import ToolError

MAX_OFFICE_MEMBERS = 3000

def _reject() -> None:
    raise ToolError(400, "文件内容与格式不匹配，或文件结构不安全，请换一个文件")

def _office(path: Path, ext: str, max_uncompressed: int) -> None:
    required = "word/document.xml" if ext == "docx" else "ppt/presentation.xml"
    try:
        with zipfile.ZipFile(str(path)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_OFFICE_MEMBERS:
                _reject()
            names = set()
            total = 0
            for item in infos:
                name = PurePosixPath(item.filename)
                if (name.is_absolute() or ".." in name.parts or
                        "\\" in item.filename or "\x00" in item.filename or
                        item.flag_bits & 1 or
                        (item.external_attr >> 16) & 0o170000 == 0o120000):
                    _reject()
                names.add(item.filename)
                total += item.file_size
                if total > max_uncompressed:
                    _reject()
                if item.file_size > 2 * 1024 * 1024 and item.file_size > 250 * max(item.compress_size, 1):
                    _reject()
                if item.filename.lower().endswith((".xml", ".rels")):
                    with archive.open(item) as reader:
                        prefix = reader.read(8192).upper()
                    if b"<!DOCTYPE" in prefix or b"<!ENTITY" in prefix:
                        _reject()
            if "[Content_Types].xml" not in names or required not in names:
                _reject()
    except (zipfile.BadZipFile, RuntimeError, OSError, ValueError, EOFError) as exc:
        raise ToolError(400, "Office 文件结构不完整或已损坏，请重新导出文件") from exc

def _image(path: Path, ext: str, pixels: int) -> None:
    try:
        from PIL import Image
    except ImportError as exc:
        raise ToolError(500, "服务器图片组件不可用") from exc
    expected = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP"}[ext]
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(str(path)) as im:
                if im.format != expected or im.width * im.height > pixels:
                    _reject()
                im.verify()
    except ToolError:
        raise
    except (OSError, ValueError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ToolError(400, "图片格式无效或分辨率过高") from exc

def validate_upload(path: Path, ext: str, *, max_office_uncompressed: int, max_image_pixels: int) -> None:
    path = Path(path)
    with path.open("rb") as fh:
        head = fh.read(16)
    if ext == "pdf":
        if not head.startswith(b"%PDF-"):
            _reject()
    elif ext in ("docx", "pptx"):
        if not head.startswith(b"PK\x03\x04"):
            _reject()
        _office(path, ext, max_office_uncompressed)
    elif ext == "png":
        if not head.startswith(b"\x89PNG\r\n\x1a\n"):
            _reject()
        _image(path, ext, max_image_pixels)
    elif ext in ("jpg", "jpeg"):
        if not head.startswith(b"\xff\xd8\xff"):
            _reject()
        _image(path, ext, max_image_pixels)
    elif ext == "webp":
        if not (head.startswith(b"RIFF") and head[8:12] == b"WEBP"):
            _reject()
        _image(path, ext, max_image_pixels)
    elif ext == "txt":
        if b"\x00" in path.read_bytes()[:8192]:
            _reject()
    else:
        _reject()
