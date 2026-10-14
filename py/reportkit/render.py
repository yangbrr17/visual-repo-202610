"""index.html rendering (architecture.md §5). Pure string building; deterministic output."""
from __future__ import annotations

import re
from typing import TYPE_CHECKING, Any

from ._util import as_list, esc, human_date, json_for_script, label

if TYPE_CHECKING:  # pragma: no cover
    from .build import BuildPlan
    from .report import Block, Page, Report

__all__ = ["render_index"]

_MENU_ICON = ('<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
              '<path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>')


def _num(v: Any) -> str:
    if isinstance(v, float):
        return (f"{v:.4f}".rstrip("0").rstrip(".")) or "0"
    return str(v)


def _height(h: Any) -> str | None:
    if h is None or h == "":
        return None
    if isinstance(h, (int, float)) and not isinstance(h, bool):
        return f"{_num(h)}px"
    s = str(h).strip()
    return s if re.fullmatch(r"[0-9.]+(px|vh|vw|rem|em|%)", s) else None


def _span(s: Any) -> int:
    try:
        return max(1, min(12, int(s)))
    except (TypeError, ValueError):
        return 12


def _sep(locale: str) -> str:
    return "：" if (locale or "").lower().startswith(("zh", "ja")) else ": "


def _source_text(src: Any, locale: str) -> str:
    items = [str(s) for s in as_list(src)]
    if not items:
        return ""
    text = "; ".join(items)
    if re.match(r"^\s*(sources?\b|来源)", text, re.I):
        return text
    return label("sources" if len(items) > 1 else "source", locale) + _sep(locale) + text


def _notes_text(notes: Any, locale: str) -> str:
    items = [str(n) for n in as_list(notes)]
    if not items:
        return ""
    if len(items) == 1:
        if re.match(r"^\s*(notes?\b|注)", items[0], re.I):
            return items[0]
        return label("note", locale) + _sep(locale) + items[0]
    return label("notes", locale) + _sep(locale) + " ".join(f"({i}) {n}" for i, n in enumerate(items, 1))


def _block_foot(source: Any, notes: Any, locale: str) -> str:
    out = []
    s = _source_text(source, locale)
    if s:
        out.append(f'<p class="rk-block__source">{esc(s)}</p>')
    n = _notes_text(notes, locale)
    if n:
        out.append(f'<p class="rk-block__notes">{esc(n)}</p>')
    return "".join(out)


def _options_script(options: dict, ind: str) -> list[str]:
    if not options:
        return []
    return [f'{ind}<script type="application/json" data-rk-options>{json_for_script(options)}</script>']


def _block(b: "Block", locale: str, ind: str) -> list[str]:
    attrs = f'class="rk-block" style="--rk-span:{_span(b.span)}" data-rk="{esc(b.component)}"'
    if b.data is not None:
        attrs += f' data-rk-data="{esc(b.data)}"'
    attrs += f' id="{esc(b.id)}"'
    out = [f"{ind}<figure {attrs}>"]
    if b.title or b.subtitle:
        out.append(f'{ind}  <figcaption class="rk-block__head">')
        if b.title:
            out.append(f'{ind}    <h3 class="rk-block__title">{esc(b.title)}</h3>')
        if b.subtitle:
            out.append(f'{ind}    <p class="rk-block__subtitle">{esc(b.subtitle)}</p>')
        out.append(f"{ind}  </figcaption>")
    if b.height == "auto":   # grows with its content (tables, text, KPI rows)
        out.append(f'{ind}  <div class="rk-block__body is-auto"></div>')
    else:
        h = _height(b.height)
        style = f' style="--rk-h:{esc(h)}"' if h else ""
        out.append(f'{ind}  <div class="rk-block__body"{style}></div>')
    out += _options_script(b.options, ind + "  ")
    foot = _block_foot(b.source, b.notes, locale)
    if foot:
        out.append(f'{ind}  <footer class="rk-block__foot">{foot}</footer>')
    out.append(f"{ind}</figure>")
    return out


def _topbar_item(b: "Block", ind: str) -> list[str]:
    attrs = f'class="rk-block rk-topbar__item" data-rk="{esc(b.component)}"'
    if b.data is not None:
        attrs += f' data-rk-data="{esc(b.data)}"'
    attrs += f' id="{esc(b.id)}"'
    options = {"tools": False, **b.options}  # no export / expand toolbar on top-bar controls
    return [f"{ind}<div {attrs}>", f'{ind}  <div class="rk-block__body"></div>',
            *_options_script(options, ind + "  "), f"{ind}</div>"]


def _page_source(report: "Report", page: "Page") -> Any:
    """Explicit page source; otherwise (content pages whose blocks carry no own source) the
    de-duplicated meta.source of the datasets used on the page. ``source=False`` disables it."""
    if page.source is False:
        return None
    if page.source is not None:
        return page.source
    if page.kind != "content" or any(b.source for b in page.blocks):
        return None
    seen: list[str] = []
    for b in page.blocks:
        ds = report.datasets.get(b.data) if b.data else None
        for s in as_list((ds or {}).get("meta", {}).get("source")):
            if str(s) not in seen:
                seen.append(str(s))
    return seen or None


def _page_foot(report: "Report", page: "Page", ind: str) -> list[str]:
    src = esc(_source_text(_page_source(report, page), report.locale))
    notes = _notes_text(page.notes, report.locale)
    if notes:
        src += f'<span class="rk-page__notes">{esc(notes)}</span>'
    spans = f'<span class="rk-page__source">{src}</span>'
    if report.confidentiality:
        spans += f'<span class="rk-page__conf">{esc(report.confidentiality)}</span>'
    spans += '<span class="rk-page__num"></span>'
    return [f'{ind}<footer class="rk-page__foot">{spans}</footer>']


def _grid(blocks: list["Block"], locale: str, ind: str) -> list[str]:
    out = [f'{ind}<div class="rk-page__body rk-grid">']
    for b in blocks:
        out += _block(b, locale, ind + "  ")
    out.append(f"{ind}</div>")
    return out


def _nav_label(page: "Page") -> str:
    if page.nav:
        return page.nav
    if page.kind == "content" and page.kicker:
        return page.kicker
    return page.title or ""


def _page(report: "Report", page: "Page", section_num: str | None, ind: str) -> list[str]:
    loc = report.locale
    i2, i3 = ind + "  ", ind + "    "
    kind_cls = "" if page.kind == "content" else f" rk-page--{page.kind}"
    out = [f'{ind}<section class="rk-page{kind_cls}" id="{esc(page.id)}" data-rk-page="{esc(_nav_label(page))}">']
    if page.kind == "cover":
        if report.confidentiality:
            out.append(f'{i2}<p class="rk-cover__conf">{esc(report.confidentiality)}</p>')
        out.append(f'{i2}<div class="rk-cover__inner">')
        if page.kicker:
            out.append(f'{i3}<p class="rk-cover__kicker">{esc(page.kicker)}</p>')
        out.append(f'{i3}<h1 class="rk-cover__title">{esc(page.title)}</h1>')
        if page.subtitle:
            out.append(f'{i3}<p class="rk-cover__subtitle">{esc(page.subtitle)}</p>')
        meta = []
        if report.client:
            meta.append(f'<span class="rk-cover__client">{esc(report.client)}</span>')
        if report.date:
            meta.append(f'<span class="rk-cover__date"><time datetime="{esc(report.date)}">'
                        f'{esc(human_date(report.date, loc))}</time></span>')
        if report.firm:
            meta.append(f'<span class="rk-cover__firm">{esc(report.firm)}</span>')
        if meta:
            out.append(f'{i3}<p class="rk-cover__meta">{"".join(meta)}</p>')
        out.append(f"{i2}</div>")
        if page.blocks:
            out += _grid(page.blocks, loc, i2)
    elif page.kind == "section":
        out.append(f'{i2}<div class="rk-section" data-rk-reveal>')
        if section_num:
            out.append(f'{i3}<p class="rk-section__num">{esc(section_num)}</p>')
        if page.kicker:
            out.append(f'{i3}<p class="rk-section__kicker">{esc(page.kicker)}</p>')
        out.append(f'{i3}<h2 class="rk-section__title">{esc(page.title)}</h2>')
        if page.subtitle:
            out.append(f'{i3}<p class="rk-section__subtitle">{esc(page.subtitle)}</p>')
        out.append(f"{i2}</div>")
        if page.blocks:
            out += _grid(page.blocks, loc, i2)
    else:
        out.append(f'{i2}<header class="rk-page__head">')
        if page.kicker:
            out.append(f'{i3}<p class="rk-page__kicker">{esc(page.kicker)}</p>')
        out.append(f'{i3}<h2 class="rk-page__title">{esc(page.title)}</h2>')
        if page.subtitle:
            out.append(f'{i3}<p class="rk-page__subtitle">{esc(page.subtitle)}</p>')
        out.append(f"{i2}</header>")
        out += _grid(page.blocks, loc, i2)
        out += _page_foot(report, page, i2)
    out.append(f"{ind}</section>")
    return out


def render_index(report: "Report", plan: "BuildPlan", *, data_source: str = "bundle", api: str | None = None) -> str:
    """data_source: 'bundle' (default; data/bundle.js, works from file://), 'http' (fetch data/*.json; needs a
    web server) or 'api' (fetch from a data API at *api* with the same JSON shapes; see docs/architecture.md)."""
    loc = report.locale
    title = report.title + (f" — {report.subtitle}" if report.subtitle else "")
    L: list[str] = [
        "<!DOCTYPE html>",
        f'<html lang="{esc(loc)}" data-rk-theme="{esc(report.theme)}"'
        + (f' data-rk-page-size="{esc(report.page_size)}"' if getattr(report, "page_size", "16:9") != "16:9" else "") + ">",
        "<head>",
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        f"  <title>{esc(title)}</title>",
        '  <meta name="rk:data" content="data/">',
        *([f'  <meta name="rk:data-source" content="{esc(data_source)}">'] if data_source != "bundle" else []),
        *([f'  <meta name="rk:api" content="{esc(api)}">'] if data_source == "api" and api else []),
        '  <meta name="generator" content="ReportKit">',
        f'  <meta name="rk:themes" content="{esc(",".join(t for t, _ in plan.themes))}">',
        f'  <meta name="rk:version" content="{esc(plan.version)}">',
        f'  <meta name="rk:built" content="{esc(plan.build_date)}">',
        '  <meta name="robots" content="noindex, nofollow">',
    ]
    L += [f'  <link rel="stylesheet" href="{esc(href)}">' for href in plan.vendor_css]
    L.append('  <link rel="stylesheet" href="assets/css/reportkit.css">')
    L += ["</head>", '<body class="rk-report">']

    # ---- sticky top bar
    L.append('  <header class="rk-topbar">')
    L.append(f'    <button type="button" class="rk-iconbtn rk-nav-toggle" data-rk-nav-toggle '
             f'aria-label="{esc(label("contents", loc))}">{_MENU_ICON}</button>')
    firm = f'<span class="rk-topbar__firm">{esc(report.firm)}</span>' if report.firm else ""
    L.append(f'    <div class="rk-topbar__brand"><span class="rk-topbar__mark" aria-hidden="true"></span>{firm}</div>')
    sub = f' title="{esc(report.subtitle)}"' if report.subtitle else ""
    L.append(f'    <div class="rk-topbar__title"{sub}>{esc(report.title)}</div>')
    if report.topbar:
        L.append('    <div class="rk-topbar__controls">')
        for b in report.topbar:
            L += _topbar_item(b, "      ")
        L.append("    </div>")
    else:
        L.append('    <div class="rk-topbar__controls"></div>')
    L.append('    <div class="rk-topbar__actions">')
    L.append(f'      <select class="rk-select" data-rk-theme-switch aria-label="{esc(label("theme", loc))}">')
    for tid, tlabel in plan.themes:
        sel = " selected" if tid == report.theme else ""
        L.append(f'        <option value="{esc(tid)}"{sel}>{esc(tlabel)}</option>')
    L.append("      </select>")
    L.append(f'      <button type="button" class="rk-btn" data-rk-print>{esc(label("print", loc))}</button>')
    L.append("    </div>")
    L.append("  </header>")
    L.append(f'  <nav class="rk-nav" data-rk-nav aria-label="{esc(label("contents", loc))}"></nav>')

    # ---- pages
    L.append('  <main class="rk-deck">')
    n_section = 0
    for page in report.pages:
        num = None
        if page.kind == "section":
            n_section += 1
            num = page.num if page.num is not None else f"{n_section:02d}"
        L += _page(report, page, num, "    ")
    L.append("  </main>")

    # ---- scripts: vendor -> core -> components -> data
    data_js = ["data/bundle.js"] if data_source == "bundle" else []
    for src in [*plan.vendor_js, "assets/js/reportkit.js", *plan.component_js, *data_js]:
        L.append(f'  <script src="{esc(src)}"></script>')
    L += ["</body>", "</html>", ""]
    return "\n".join(L)
