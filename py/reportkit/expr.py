"""Minimal port of the RK.expr tokeniser (kit/core/rk.expr.js) used to validate computed formulas
at build time: which @params and which field names a formula references."""
from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = ["ExprSyntaxError", "formula_refs", "norm_name"]

_IDENT_START = re.compile(r"[A-Za-z_À-￿]")
_IDENT_PART = re.compile(r"[A-Za-z0-9_À-￿]")
_NUM = re.compile(r"(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
_PARAM = re.compile(r"[A-Za-z_]\w*")
_OPS = ["==", "!=", "<>", "<=", ">=", "&&", "||", "+", "-", "*", "/", "^", "<", ">", "=", "!",
        "(", ")", ",", "?", ":", "[", "]"]
_DIGITS = "0123456789"
_KEYWORDS = {"and", "or", "not", "in", "true", "false", "null"}


class ExprSyntaxError(ValueError):
    def __init__(self, message: str, pos: int = -1):
        super().__init__(message)
        self.pos = pos


@dataclass
class _Tok:
    t: str
    v: object = None
    pos: int = 0
    quoted: bool = False


def _tokenize(src: str) -> list[_Tok]:
    toks: list[_Tok] = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c.isspace():
            i += 1
            continue
        start = i
        if c in _DIGITS or (c == "." and i + 1 < n and src[i + 1] in _DIGITS):
            m = _NUM.match(src, i)
            i = m.end()
            if i < n and src[i] == "%":
                i += 1
            toks.append(_Tok("num", m.group(0), start))
            continue
        if c in "\"'":
            q, i = c, i + 1
            while i < n and src[i] != q:
                i += 2 if src[i] == "\\" and i + 1 < n else 1
            if i >= n:
                raise ExprSyntaxError("Unterminated string", start)
            i += 1
            toks.append(_Tok("str", None, start))
            continue
        if c == "`":
            j = src.find("`", i + 1)
            if j < 0:
                raise ExprSyntaxError("Unterminated `name`", start)
            toks.append(_Tok("id", src[i + 1:j], start, True))
            i = j + 1
            continue
        if c == "@":
            m = _PARAM.match(src, i + 1)
            if not m:
                raise ExprSyntaxError("Expected parameter name after @", start)
            toks.append(_Tok("param", m.group(0), start))
            i = m.end()
            continue
        if _IDENT_START.match(c):
            j = i
            while j < n and _IDENT_PART.match(src[j]):
                j += 1
            word = src[i:j]
            toks.append(_Tok("kw", word.lower(), start) if word.lower() in _KEYWORDS else _Tok("id", word, start))
            i = j
            continue
        if c == "[":
            prev = toks[-1] if toks else None
            prev_operand = prev is not None and (prev.t in ("num", "str", "id", "param")
                                                 or (prev.t == "op" and prev.v in (")", "]")))
            close = src.find("]", i + 1)
            inner = src[i + 1:close] if close > 0 else ""
            if (not prev_operand and close > 0 and not (prev and prev.t == "kw" and prev.v == "in")
                    and re.fullmatch(r"[^\[\],\"']+", inner) and re.search(r"[A-Za-zÀ-￿]", inner)
                    and not re.match(r"\s*-?\d", inner)):
                toks.append(_Tok("id", inner.strip(), start, True))
                i = close + 1
                continue
        op = next((o for o in _OPS if src.startswith(o, i)), None)
        if op is None:
            raise ExprSyntaxError(f'Unexpected character "{c}"', start)
        toks.append(_Tok("op", op, start))
        i += len(op)
    return toks


def formula_refs(src: str) -> tuple[list[str], list[str], list[str]]:
    """Return (params, field_names, function_names) referenced by *src* (first-seen order).

    Raises ExprSyntaxError for tokenizer-level errors.
    """
    toks = _tokenize(str(src))
    params: list[str] = []
    fields: list[str] = []
    funcs: list[str] = []
    for k, t in enumerate(toks):
        if t.t == "param" and t.v not in params:
            params.append(t.v)
        elif t.t == "id":
            nxt = toks[k + 1] if k + 1 < len(toks) else None
            if not t.quoted and nxt is not None and nxt.t == "op" and nxt.v == "(":
                if t.v.lower() not in funcs:
                    funcs.append(t.v.lower())
            elif t.v not in fields:
                fields.append(t.v)
    return params, fields, funcs


def norm_name(s: str) -> str:
    """Same normalisation the browser uses to match a formula name to a field name / title."""
    return re.sub(r"[\s_]+", " ", str(s).lower()).strip()
