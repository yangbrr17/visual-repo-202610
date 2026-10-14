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
    "colon", "list_sep", "source_text", "notes_text",
]


def esc(value: Any) -> str:
    """HTML-escape text content (also safe inside double-quoted attributes)."""
    return html.escape("" if value is None else str(value), quote=True)


attr = esc


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def _slug_char(ch: str) -> str:
    """One character of a Unicode-aware slug: ASCII letters / digits as is; accented Latin letters folded to
    ASCII ('é' -> 'e'); other letters and digits (CJK, kana, Cyrillic ...) kept; anything else a separator."""
    if ch.isascii():
        return ch if ch.isalnum() else "-"
    folded = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))
    if folded and folded.isascii():
        return "".join(c if c.isalnum() else "-" for c in folded.lower())
    return ch if ch.isalnum() else "-"


def _non_latin(ch: str) -> bool:
    """A letter / digit of a script other than Latin or Greek (CJK, kana, Hangul, Cyrillic ...), which the
    ASCII slug would drop."""
    if ch.isascii() or not ch.isalnum():
        return False
    return any(not c.isascii() and c.isalnum() and not unicodedata.name(c, "").startswith(("LATIN", "GREEK"))
               for c in unicodedata.normalize("NFKD", ch))


def slugify(text: Any, max_len: int = 48, *, ascii_only: bool = False) -> str:
    """Slug for ids / anchors / file names: 'Implied value — $4.2bn' -> 'implied-value-4-2bn'.

    Text in another script keeps its letters ('估值：DCF 与可比公司' -> '估值-dcf-与可比公司'), so Chinese titles give
    meaningful page ids and file names; Latin text (with Greek symbols such as Δ) gives exactly the ASCII slug
    (accents folded, other symbols dropped). ascii_only=True always returns the ASCII slug (e.g. dataset ids)."""
    raw = str(text or "")
    s = unicodedata.normalize("NFKD", raw).encode("ascii", "ignore").decode("ascii").lower()
    s = _SLUG_STRIP.sub("-", s).strip("-")
    if not ascii_only and any(_non_latin(ch) for ch in raw):
        s = re.sub(r"-{2,}", "-", "".join(_slug_char(ch) for ch in unicodedata.normalize("NFKC", raw).lower()))
        s = s.strip("-")
    # max_len counts display columns: a wide (CJK) character counts 2, so Chinese slugs stay as compact as English
    cut, width = 0, 0
    for cut, ch in enumerate(s):
        width += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if width > max_len:
            break
    else:
        return s
    head = s[:cut]
    return (head.rsplit("-", 1)[0] if "-" in head else head).strip("-")


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
    "zh": {"source": "资料来源", "sources": "资料来源", "note": "注", "notes": "注",
           "print": "打印 / PDF", "theme": "配色主题", "contents": "目录", "filters": "筛选",
           "excel": "Excel 数据", "excel_title": "下载全部数据集（Excel 工作簿）",
           "unit": "单位", "as_of": "数据截至", "computed": "报告中实时计算的字段（本表未包含）", "fields": "字段"},
}


def label(key: str, locale: str = "en-US") -> str:
    lang = (locale or "en").split("-")[0].lower()
    return _LABELS.get(lang, _LABELS["en"]).get(key, _LABELS["en"][key])


def _cjk(locale: str | None) -> bool:
    return (locale or "").lower().startswith(("zh", "ja"))


def colon(locale: str | None) -> str:
    """Label separator: ': ' / full-width '：' (zh, ja)."""
    return "：" if _cjk(locale) else ": "


def list_sep(locale: str | None) -> str:
    """Separator between several sources: '; ' / full-width '；' (zh, ja)."""
    return "；" if _cjk(locale) else "; "


# text that already carries its own label is printed as is: "Sources: …", "资料来源：…", "来源：…" / "Note: …", "注：…"
_SOURCE_PREFIX = re.compile(r"^\s*(sources?\b|(资料)?来源)", re.I)
_NOTES_PREFIX = re.compile(r"^\s*(notes?\b|注释?\s*[:：(（\d])", re.I)


def source_text(src: Any, locale: str = "en-US") -> str:
    """'Source: FactSet' / 'Sources: A; B' / '资料来源：万得；公司公告' — one line for a block / page footer."""
    items = [str(s) for s in as_list(src)]
    if not items:
        return ""
    text = list_sep(locale).join(items)
    if _SOURCE_PREFIX.match(text):
        return text
    return label("sources" if len(items) > 1 else "source", locale) + colon(locale) + text


def notes_text(notes: Any, locale: str = "en-US") -> str:
    """'Note: …' / 'Notes: (1) … (2) …' / '注：…'."""
    items = [str(n) for n in as_list(notes)]
    if not items:
        return ""
    if len(items) == 1:
        if _NOTES_PREFIX.match(items[0]):
            return items[0]
        return label("note", locale) + colon(locale) + items[0]
    return label("notes", locale) + colon(locale) + " ".join(f"({i}) {n}" for i, n in enumerate(items, 1))
