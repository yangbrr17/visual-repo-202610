"""Small shared helpers: escaping, slugs, deterministic JSON, dates."""
from __future__ import annotations

import datetime as _dt
import html
import json
import re
import unicodedata
from typing import Any, Iterable

__all__ = [
    "esc", "attr", "slugify", "unique_id", "dumps", "json_for_script", "iso_date", "human_date", "as_list", "label",
]


def esc(value: Any) -> str:
    """HTML-escape text content (also safe inside double-quoted attributes)."""
    return html.escape("" if value is None else str(value), quote=True)


attr = esc


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(text: Any, max_len: int = 48) -> str:
    """ASCII slug for ids/anchors: 'Implied value — $4.2bn' -> 'implied-value-4-2bn'."""
    s = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode("ascii").lower()
    s = _SLUG_STRIP.sub("-", s).strip("-")
    if len(s) > max_len:
        s = s[:max_len].rsplit("-", 1)[0] if "-" in s[:max_len] else s[:max_len]
    return s.strip("-")


def unique_id(base: str, used: set[str]) -> str:
    """Return base, or base-2, base-3 ... whichever is not in *used*; records the result."""
    cand, n = base, 2
    while cand in used:
        cand = f"{base}-{n}"
        n += 1
    used.add(cand)
    return cand


def dumps(obj: Any, *, indent: int | None = None) -> str:
    """JSON text, keys in insertion order, UTF-8 friendly, NaN forbidden."""
    seps = (",", ": ") if indent is not None else (", ", ": ")
    text = json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=indent, separators=seps)
    # U+2028/2029 are valid JSON but historically broke JS parsers; keep output portable.
    return text.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def json_for_script(obj: Any) -> str:
    """JSON safe to inline in <script type="application/json">: '</' -> '<\\/', '<!--' escaped.

    Key order is kept (it is deterministic for a given script and may be meaningful to a component,
    e.g. the order of groups / colour maps)."""
    text = dumps(obj)
    return text.replace("</", "<\\/").replace("<!--", "\\u003c!--")


_ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def iso_date(value: Any) -> str | None:
    """date / datetime / ISO-ish string -> 'YYYY-MM-DD' (strings that are not dates pass through)."""
    if value is None or value == "":
        return None
    if isinstance(value, _dt.datetime):
        return value.date().isoformat()
    if isinstance(value, _dt.date):
        return value.isoformat()
    # pandas.Timestamp / numpy.datetime64 without importing them
    if hasattr(value, "to_pydatetime"):
        return value.to_pydatetime().date().isoformat()
    s = str(value).strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[T ]", s)
    return m.group(1) if m else s


_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"]


def human_date(value: str | None, locale: str = "en-US") -> str:
    """'2026-10-14' -> 'October 14, 2026' (en-US) / '14 October 2026' (en-GB...) / '2026年10月14日' (zh)."""
    if not value:
        return ""
    m = _ISO_DATE.match(str(value))
    if not m:
        return str(value)
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return str(value)
    loc = (locale or "en-US").lower()
    if loc.startswith(("zh", "ja")):
        return f"{y}年{mo}月{d}日"
    if loc in ("en-us", "en"):
        return f"{_MONTHS[mo - 1]} {d}, {y}"
    if loc.startswith("en"):
        return f"{d} {_MONTHS[mo - 1]} {y}"
    return str(value)


def as_list(value: Any) -> list:
    """None -> [], str -> [str], iterable -> list."""
    if value is None or value == "":
        return []
    if isinstance(value, (str, bytes, dict)):
        return [value]
    if isinstance(value, Iterable):
        return [v for v in value if v is not None and v != ""]
    return [value]


_LABELS = {
    "en": {"source": "Source", "sources": "Sources", "note": "Note", "notes": "Notes",
           "print": "Print / PDF", "theme": "Colour theme", "contents": "Contents",
           "filters": "Filters", "excel": "Excel", "excel_title": "Download every dataset as an Excel workbook",
           "unit": "Unit", "as_of": "As of", "computed": "Calculated live in the report (not in this sheet)",
           "fields": "fields"},
    "zh": {"source": "来源", "sources": "来源", "note": "注", "notes": "注",
           "print": "打印 / PDF", "theme": "配色主题", "contents": "目录", "filters": "筛选",
           "excel": "Excel 数据", "excel_title": "下载全部数据集（Excel 工作簿）",
           "unit": "单位", "as_of": "数据截至", "computed": "报告中实时计算的字段（本表未包含）", "fields": "字段"},
}


def label(key: str, locale: str = "en-US") -> str:
    lang = (locale or "en").split("-")[0].lower()
    return _LABELS.get(lang, _LABELS["en"]).get(key, _LABELS["en"][key])
