"""Title templates (architecture contract I1).

A page title / subtitle / kicker or a block title / subtitle may contain placeholders that the
runtime fills from the *currently filtered* data::

    "Helios trades at {{peers: median(ev_ebitda_25e) | 0.0x}} vs. a peer range of
     {{peers: min(ev_ebitda_25e) | 0.0x}}–{{peers: max(ev_ebitda_25e) | 0.0x}}"
    "DCF at {{@wacc | 0.0%}} WACC"

Placeholder grammar: ``{{ [<dataset id> :] <RK.expr expression> [| <format code>] }}``

- ``<dataset id>:`` names the dataset (aggregates such as ``median(x)`` are evaluated over its filtered
  rows; a plain field / row expression uses the first filtered row). Without it the runtime uses the
  context's dataset — a block title's own dataset, or for page titles the first data-bound block of the
  page — and an expression that only uses ``@params`` needs none.
- The format code is everything after the first single ``|`` outside quotes (``||`` is the
  logical-or operator, never the separator); omitted / empty = inferred by the runtime (a param's own
  format, else the format of the field the expression reads).

The builder emits ``data-rk-template="<raw template>"`` and, as the element's text, the template with
every placeholder replaced by ``…`` (shown until the runtime evaluates it, and in no-JS previews).
"""
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass
from typing import Any

from .expr import ExprSyntaxError, formula_refs, norm_name

__all__ = ["Placeholder", "TemplateError", "FALLBACK", "has_template", "parse_template", "fallback_text",
           "check_template"]

FALLBACK = "…"   # "…"
_PLACEHOLDER_RE = re.compile(r"\{\{(.*?)\}\}", re.S)
_DATASET_PREFIX_RE = re.compile(r"^\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!:)")


class TemplateError(ValueError):
    """A title template is malformed."""


@dataclass(frozen=True)
class Placeholder:
    raw: str                 # "{{peers: median(x) | 0.0x}}"
    dataset: str | None      # "peers" or None (params only)
    expr: str                # "median(x)"
    format: str | None       # "0.0x" or None


def has_template(text: Any) -> bool:
    """True when *text* is a string containing ``{{`` (a template, possibly malformed)."""
    return isinstance(text, str) and "{{" in text


def _split_format(inner: str) -> tuple[str, str | None]:
    """Split at the first single '|' outside quotes / backticks ('||' is an operator)."""
    quote = None
    i, n = 0, len(inner)
    while i < n:
        c = inner[i]
        if quote:
            if c == "\\" and quote != "`":
                i += 2
                continue
            if c == quote:
                quote = None
        elif c in "\"'`":
            quote = c
        elif c == "|":
            if i + 1 < n and inner[i + 1] == "|":
                i += 2
                continue
            return inner[:i], inner[i + 1:]
        i += 1
    return inner, None


def parse_template(text: str) -> list[Placeholder]:
    """Parse every ``{{ ... }}`` placeholder of *text*. Raises TemplateError for malformed templates."""
    if not isinstance(text, str):
        return []
    out: list[Placeholder] = []
    rest = _PLACEHOLDER_RE.sub("", text)
    if "{{" in rest or "}}" in rest:
        raise TemplateError("unbalanced '{{' / '}}' (placeholders look like {{dataset: expression | format}})")
    for m in _PLACEHOLDER_RE.finditer(text):
        inner = m.group(1)
        if "{{" in inner:
            raise TemplateError(f"nested '{{{{' in placeholder {m.group(0)!r}")
        body, fmt = _split_format(inner)
        dataset = None
        dm = _DATASET_PREFIX_RE.match(body)
        if dm and not body.lstrip().startswith("@"):
            dataset = dm.group(1)
            body = body[dm.end():]
        expr = body.strip()
        if not expr:
            raise TemplateError(f"empty expression in placeholder {m.group(0)!r}")
        if expr.startswith(":"):
            raise TemplateError(f"missing dataset id before ':' in placeholder {m.group(0)!r}")
        if fmt is not None:
            fmt = fmt.strip() or None
        out.append(Placeholder(m.group(0), dataset, expr, fmt))
    return out


def fallback_text(text: Any) -> str:
    """The template with each placeholder replaced by '…' (plain text passes through)."""
    if text is None:
        return ""
    s = str(text)
    return _PLACEHOLDER_RE.sub(FALLBACK, s) if "{{" in s else s


def _did_you_mean(name: str, options: list[str]) -> str:
    close = difflib.get_close_matches(str(name), [str(o) for o in options], n=3, cutoff=0.6)
    return f" — did you mean {', '.join(repr(c) for c in close)}?" if close else ""


def _available_names(ds: dict) -> set[str]:
    fields = (ds.get("schema") or {}).get("fields", [])
    names = {norm_name(f["name"]) for f in fields}
    names |= {norm_name(f["title"]) for f in fields if f.get("title")}
    for c in ds.get("computed") or []:
        if c.get("name"):
            names.add(norm_name(c["name"]))
        if c.get("title"):
            names.add(norm_name(c["title"]))
    return names


def check_template(text: Any, datasets: dict[str, dict], params: dict[str, Any],
                   default_dataset: str | None = None) -> list[str]:
    """Problems with the template *text* (empty list when fine, or when *text* has no '{{').

    default_dataset: the dataset the runtime uses for placeholders without a "<dataset>:" prefix
    (a block's own dataset; for page titles the first data-bound block of the page)."""
    if not has_template(text):
        return []
    try:
        placeholders = parse_template(text)
    except TemplateError as e:
        return [str(e)]
    problems: list[str] = []
    for ph in placeholders:
        try:
            pnames, refs, _funcs = formula_refs(ph.expr)
        except ExprSyntaxError as e:
            problems.append(f"placeholder {ph.raw!r}: expression {ph.expr!r} is invalid ({e})")
            continue
        for p in pnames:
            if p not in params:
                problems.append(f"placeholder {ph.raw!r} uses @{p} but no param '{p}' is defined")
        dsid = ph.dataset or (default_dataset if refs else None)
        if dsid is None:
            if refs:
                problems.append(f"placeholder {ph.raw!r} references field(s) {', '.join(refs)} but names no dataset "
                                f"(and there is no data-bound block to default to) — write {{{{<dataset>: {ph.expr}}}}}")
            continue
        ds = datasets.get(dsid)
        if ds is None:
            if ph.dataset:   # (an unknown *default* dataset is already reported on the block itself)
                problems.append(f"placeholder {ph.raw!r}: unknown dataset '{ph.dataset}'"
                                f"{_did_you_mean(ph.dataset, list(datasets))}")
            continue
        avail = _available_names(ds)
        for ref in refs:
            if norm_name(ref) not in avail:
                names = [f["name"] for f in (ds.get("schema") or {}).get("fields", [])]
                names += [c["name"] for c in ds.get("computed") or [] if c.get("name")]
                hint = _did_you_mean(ref, names)
                problems.append(f"placeholder {ph.raw!r}: field '{ref}' is not in dataset '{dsid}'{hint}")
    return problems
