"""Command line: ``python -m reportkit build|validate|components|new-component``."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from ._util import dumps
from .errors import ReportKitError, ReportValidationError
from .kit import CATEGORIES, COMPONENT_ID_RE, Kit
from .report import Report

__all__ = ["main", "scaffold_component"]


def _kit(args) -> Kit:
    return Kit(args.kit) if getattr(args, "kit", None) else Kit.locate()


def _print_warnings(warnings: list[str]) -> None:
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)


def cmd_build(args) -> int:
    kit = _kit(args)
    report = Report.from_spec(args.spec)
    warnings = report.validate(kit) if not args.no_validate else []
    _print_warnings(warnings)
    out = report.build(args.out_dir, clean=not args.no_clean, validate=False, kit=kit, build_date=args.date)
    print(f"Built {out / 'index.html'}  ({len(report.pages)} pages, {len(report.datasets)} datasets)")
    return 0


def cmd_validate(args) -> int:
    kit = _kit(args)
    report = Report.from_spec(args.spec)
    errors, warnings = report.check(kit)
    _print_warnings(warnings)
    if errors:
        print(str(ReportValidationError(errors)), file=sys.stderr)
        return 1
    blocks = sum(len(p.blocks) for p in report.pages) + len(report.topbar)
    print(f"OK: {len(report.pages)} pages, {blocks} blocks, {len(report.datasets)} datasets, "
          f"{len(report.params)} params ({len(warnings)} warnings)")
    return 0


def cmd_components(args) -> int:
    kit = _kit(args)
    rows = []
    for m in kit.components():
        if args.category and m.get("category") != args.category:
            continue
        rows.append({"id": m.get("id", ""), "category": m.get("category", ""), "name": m.get("name", ""),
                     "name_zh": m.get("name_zh", ""), "deps": ",".join(m.get("deps") or []) or "-",
                     "needs_data": Kit.needs_data(m)})
    if args.json:
        print(dumps(rows, indent=2))
        return 0
    if not rows:
        print("(no components found in kit/components/)")
        return 0
    cols = [("id", "ID"), ("category", "CATEGORY"), ("name", "NAME"), ("deps", "DEPS")]
    width = {k: max(len(h), *(len(str(r[k])) for r in rows)) for k, h in cols}
    print("  ".join(h.ljust(width[k]) for k, h in cols).rstrip())
    print("  ".join("-" * width[k] for k, _ in cols))
    for r in rows:
        print("  ".join(str(r[k]).ljust(width[k]) for k, _ in cols).rstrip())
    print(f"\n{len(rows)} component(s)")
    return 0


# ---------------------------------------------------------------------------------------------
# new-component scaffold
# ---------------------------------------------------------------------------------------------
_JS_ECHARTS = """/*!
 * RK component: {id} — {name}
 * Contract: docs/architecture.md §6. Mounted on <figure class="rk-block" data-rk="{id}" data-rk-data="...">.
 * ctx: el, block, options, enc, dataset, rows, allRows, field(), title(), fmtOf(), format(), theme,
 *      select(field, value), selected(field), store, print, motion.
 */
(function () {{
  'use strict';

  RK.component({{
    id: '{id}',
    deps: ['echarts'],
    needsData: true,
    defaults: {{
      encode: {{ x: 'x', y: 'y' }},
      format: null            // value format; defaults to the y field's format
    }},
    render: RK.chart(function build(ctx) {{
      var x = ctx.enc.x, y = ctx.enc.y, t = ctx.theme;
      var fmt = ctx.options.format || ctx.fmtOf(y);
      var sel = ctx.selected(x);
      return {{
        grid: {{ left: 8, right: 16, top: 24, bottom: 8, containLabel: true }},
        tooltip: {{ trigger: 'axis', valueFormatter: function (v) {{ return ctx.format(v, fmt); }} }},
        xAxis: {{ type: 'category', data: ctx.rows.map(function (r) {{ return r[x]; }}) }},
        yAxis: {{ type: 'value', axisLabel: {{ formatter: function (v) {{ return ctx.format(v, fmt); }} }} }},
        series: [{{
          type: 'bar',
          name: ctx.title(y),
          data: ctx.rows.map(function (r) {{
            var on = !sel.length || sel.indexOf(r[x]) >= 0;
            return {{ value: r[y], itemStyle: {{ color: on ? t.cat[0] : t.neutral }} }};
          }})
        }}]
      }};
    }}, {{
      // click -> cross-filter the other blocks on the same dataset
      select: function (params, ctx) {{ return {{ field: ctx.enc.x, value: params.name }}; }}
    }})
  }});
}})();
"""

_JS_DOM = """/*!
 * RK component: {id} — {name}
 * Contract: docs/architecture.md §6. Mounted on <figure class="rk-block" data-rk="{id}">.
 * Pure DOM (no chart engine). render(ctx) returns {{ update(ctx), resize(), destroy() }}.
 */
(function () {{
  'use strict';
  var h = RK.util.h;

  function draw(ctx) {{
    ctx.el.innerHTML = '';
    var enc = ctx.enc;
    var list = h('ul.rk-{id}');
    (ctx.rows || []).forEach(function (r) {{
      list.appendChild(h('li', String(r[enc.label]), ' ', ctx.format(r[enc.value], ctx.options.format || ctx.fmtOf(enc.value))));
    }});
    ctx.el.appendChild(list);
  }}

  RK.component({{
    id: '{id}',
    deps: [],
    needsData: {needs_data},
    defaults: {{
      encode: {{ label: 'label', value: 'value' }},
      format: null
    }},
    render: function (ctx) {{
      draw(ctx);
      return {{
        update: function (next) {{ draw(next); }},
        resize: function () {{}},
        destroy: function () {{ ctx.el.innerHTML = ''; }}
      }};
    }}
  }});
}})();
"""


def scaffold_component(kit: Kit, cid: str, category: str, *, name: str | None = None,
                       engine: str = "echarts", force: bool = False) -> Path:
    """Create kit/components/<cid>/ with manifest.json and <cid>.js following the contract."""
    if not COMPONENT_ID_RE.fullmatch(cid):
        raise ReportKitError(f"component id '{cid}' must be kebab-case (e.g. 'waterfall', 'football-field')")
    if category not in CATEGORIES:
        raise ReportKitError(f"category '{category}' must be one of: {', '.join(CATEGORIES)}")
    if engine not in ("echarts", "dom"):
        raise ReportKitError("engine must be 'echarts' or 'dom'")
    d = kit.component_dir(cid)
    if d.exists() and any(d.iterdir()) and not force:
        raise ReportKitError(f"{d} already exists (use --force to overwrite)")
    d.mkdir(parents=True, exist_ok=True)
    name = name or cid.replace("-", " ").title()
    is_chart = engine == "echarts"
    needs_data = category not in ("layout", "controls")
    channels = ({"x": {"type": "string", "required": True, "default": "x", "desc": "Category field"},
                 "y": {"type": "number", "required": True, "default": "y", "desc": "Value field"}}
                if is_chart else
                {"label": {"type": "string", "required": needs_data, "default": "label", "desc": "Label field"},
                 "value": {"type": "number", "required": needs_data, "default": "value", "desc": "Value field"}})
    sample_enc = {"x": "x", "y": "y"} if is_chart else {"label": "label", "value": "value"}
    manifest = {
        "id": cid,
        "name": name,
        "name_zh": "TODO 中文名",
        "category": category,
        "engine": "echarts" if is_chart else "dom",
        "deps": ["echarts"] if is_chart else [],
        "needs_data": needs_data,
        "summary": "TODO one-line summary (what it shows).",
        "summary_zh": "TODO 一句话说明。",
        "description_zh": "TODO 能展示什么、适合什么数据、怎么读。",
        "best_for": ["TODO"],
        "avoid_when": ["TODO"],
        "channels": channels,
        "options": {"format": {"type": "string", "default": None, "desc": "Value format code"}},
        "interactions": ["hover tooltip", "click to cross-filter"] if is_chart else [],
        "samples": [{"title": f"{name} sample", "data": "TODO_dataset", "height": 320,
                     "options": {"encode": sample_enc}}],
    }
    (d / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                     encoding="utf-8", newline="\n")
    tpl = _JS_ECHARTS if is_chart else _JS_DOM
    (d / f"{cid}.js").write_text(tpl.format(id=cid, name=name, needs_data=str(needs_data).lower()),
                                 encoding="utf-8", newline="\n")
    return d


def cmd_new_component(args) -> int:
    kit = _kit(args)
    d = scaffold_component(kit, args.id, args.category, name=args.name, engine=args.engine, force=args.force)
    print(f"Created {d}/manifest.json and {d}/{args.id}.js — fill in the TODOs, then add a sample dataset.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="reportkit", description="ReportKit report builder")
    ap.add_argument("--version", action="version", version=f"reportkit {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def kit_opt(p):
        p.add_argument("--kit", help="kit root (folder containing kit/build.json); default $REPORTKIT_HOME or auto")

    b = sub.add_parser("build", help="build a report folder from a JSON layout spec")
    b.add_argument("spec")
    b.add_argument("out_dir")
    b.add_argument("--no-validate", action="store_true", help="skip validation")
    b.add_argument("--no-clean", action="store_true", help="do not remove previous build output first")
    b.add_argument("--date", help="build date stamped in asset headers (default: report date)")
    kit_opt(b)
    b.set_defaults(func=cmd_build)

    v = sub.add_parser("validate", help="validate a JSON layout spec (lists every problem)")
    v.add_argument("spec")
    kit_opt(v)
    v.set_defaults(func=cmd_validate)

    c = sub.add_parser("components", help="list available components")
    c.add_argument("--category", choices=CATEGORIES)
    c.add_argument("--json", action="store_true")
    kit_opt(c)
    c.set_defaults(func=cmd_components)

    n = sub.add_parser("new-component", help="scaffold kit/components/<id>/")
    n.add_argument("id")
    n.add_argument("--category", required=True, choices=CATEGORIES)
    n.add_argument("--name", help="display name (default: from id)")
    n.add_argument("--engine", choices=("echarts", "dom"), default="echarts")
    n.add_argument("--force", action="store_true")
    kit_opt(n)
    n.set_defaults(func=cmd_new_component)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except ReportValidationError as e:
        print(str(e), file=sys.stderr)
        return 1
    except ReportKitError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
