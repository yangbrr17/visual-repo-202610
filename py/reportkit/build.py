"""Write the self-contained report folder (architecture.md §3)."""
from __future__ import annotations

import base64
import datetime as _dt
import json
import mimetypes
import os
import posixpath
import re
import shutil
import warnings as _warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING

from ._util import dumps, slugify
from .errors import BuildError
from .kit import Kit
from .validate import DATASET_ID_RE, get_kit, validate as _validate

if TYPE_CHECKING:  # pragma: no cover
    from .report import Report

__all__ = ["build", "plan", "BuildPlan", "dataset_json_text", "bundle_js_text", "ReportKitWarning",
           "inline_script_text", "inline_style_text", "report_slug"]


class ReportKitWarning(UserWarning):
    """Non-blocking validation notes emitted by Report.build()."""


@dataclass
class BuildPlan:
    kit: Kit
    version: str
    build_date: str
    components: list[str] = field(default_factory=list)          # sorted component ids actually used
    manifests: dict[str, dict] = field(default_factory=dict)
    vendor: list[dict] = field(default_factory=list)             # vendor.json packages, vendor.json order
    vendor_css: list[str] = field(default_factory=list)          # hrefs relative to index.html
    vendor_js: list[str] = field(default_factory=list)
    component_js: list[str] = field(default_factory=list)
    themes: list[tuple[str, str]] = field(default_factory=list)  # (id, label)


def _resolve_build_date(report: "Report", build_date: Any) -> str:
    if build_date:
        return str(build_date)
    if report.date:
        return report.date
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if epoch and epoch.isdigit():
        return _dt.datetime.fromtimestamp(int(epoch), _dt.timezone.utc).date().isoformat()
    return _dt.date.today().isoformat()


def _href(*parts: str) -> str:
    from urllib.parse import quote
    return "/".join(quote(p.strip("/"), safe="/._-~") for p in parts)


def plan(report: "Report", kit: Any = None, *, build_date: Any = None) -> BuildPlan:
    """Work out which components / vendor files a report needs (no I/O besides reading manifests)."""
    kit = get_kit(kit)
    report.resolve_ids()
    used = sorted({b.component for b in report.iter_blocks() if kit.component(b.component)})
    manifests = {c: kit.component(c) for c in used}
    deps: list[str] = []
    for c in used:
        for d in manifests[c].get("deps") or []:
            if d not in deps:
                deps.append(d)
    # option-driven vendor deps (manifest "optionDeps", e.g. basemap: "world-50m" -> geo-world-50m)
    for b in report.iter_blocks():
        m = manifests.get(b.component)
        if m:
            for d in Kit.option_deps(m, b.options):
                if d not in deps and kit.vendor_package(d):
                    deps.append(d)
    vendor = kit.resolve_vendor(deps)
    p = BuildPlan(kit=kit, version=kit.version, build_date=_resolve_build_date(report, build_date),
                  components=used, manifests=manifests, vendor=vendor)
    for pkg in vendor:
        p.vendor_css += [_href("assets/vendor", pkg["id"], f) for f in Kit.vendor_files(pkg, ".css")]
        p.vendor_js += [_href("assets/vendor", pkg["id"], f) for f in Kit.vendor_files(pkg, ".js")]
    p.component_js = [_href("assets/js/components", f"{c}.js") for c in used]
    p.themes = [(t, kit.theme_label(t)) for t in kit.themes]
    return p


# ---------------------------------------------------------------------------------------------
# Data files
# ---------------------------------------------------------------------------------------------
def _json_list_block(items: list, indent: str) -> str:
    if not items:
        return "[]"
    inner = ",\n".join(f"{indent}  {dumps(x)}" for x in items)
    return f"[\n{inner}\n{indent}]"


def dataset_json_text(ds: dict) -> str:
    """Contract dataset JSON, one row / field per line so diffs between builds stay reviewable."""
    parts = []
    for key, val in ds.items():
        if key == "schema" and isinstance(val, dict) and set(val) == {"fields"}:
            text = '{"fields": ' + _json_list_block(val["fields"], "  ") + "}"
        elif key in ("data", "computed") and isinstance(val, list):
            text = _json_list_block(val, "  ")
        else:
            text = dumps(val)
        parts.append(f"  {dumps(key)}: {text}")
    return "{\n" + ",\n".join(parts) + "\n}"


def bundle_js_text(manifest: dict, datasets: dict[str, dict]) -> str:
    """data/bundle.js: ``RK.data.preload({"manifest": ..., "datasets": {...}});``"""
    entries = ",\n".join(f"{dumps(did)}: {dataset_json_text(ds)}" for did, ds in datasets.items())
    body = '{"manifest": ' + dumps(manifest) + ',\n"datasets": {' + ("\n" + entries + "\n" if entries else "") + "}}"
    if len(body) > BUNDLE_PARSE_THRESHOLD:
        # large bundles: JSON.parse of a string literal loads ~2-3x faster than an object literal
        compact = json.dumps(json.loads(body), ensure_ascii=False, separators=(",", ":"))
        return "RK.data.preload(JSON.parse(" + json.dumps(compact, ensure_ascii=True) + "));\n"
    return "RK.data.preload(" + body + ");\n"


BUNDLE_PARSE_THRESHOLD = 1_000_000  # characters; below this keep the readable, diff-friendly form


# ---------------------------------------------------------------------------------------------
# Output folder
# ---------------------------------------------------------------------------------------------
def _is_report_data(d: Path) -> bool:
    m = d / "manifest.json"
    if m.is_file():
        try:
            return "reportkit" in json.loads(m.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return False
    b = d / "bundle.js"
    return b.is_file() and b.read_text(encoding="utf-8", errors="replace").startswith("RK.data.preload(")


def _is_report_assets(d: Path) -> bool:
    return (d / "js" / "reportkit.js").is_file() or (d / "css" / "reportkit.css").is_file()


def _is_report_index(p: Path) -> bool:
    try:
        return 'name="generator" content="ReportKit' in p.read_text(encoding="utf-8", errors="replace")[:4000]
    except OSError:
        return False


def _prepare_out(out: Path, clean: bool) -> None:
    if out.exists() and not out.is_dir():
        raise BuildError(f"{out} exists and is not a folder")
    if (out / "kit" / "build.json").is_file():
        raise BuildError(f"refusing to build into {out}: it is a ReportKit kit root")
    out.mkdir(parents=True, exist_ok=True)
    if not clean:
        return
    # Only ever remove what a previous build wrote — never unrelated files (e.g. an analyst's data/ folder).
    checks = [("assets", _is_report_assets), ("data", _is_report_data)]
    foreign = [name for name, ok in checks if (out / name).exists() and not ((out / name).is_dir() and ok(out / name))]
    idx = out / "index.html"
    if idx.exists() and not _is_report_index(idx):
        foreign.append("index.html")
    if foreign:
        raise BuildError(f"refusing to clean {out}: {', '.join(foreign)} not written by ReportKit. "
                         "Choose an empty / dedicated output folder (or pass clean=False).")
    # remove only the paths a build writes; anything else an analyst put in data/ or assets/ survives
    for rel in ("assets/js", "assets/css", "assets/vendor", "assets/fonts", "data/datasets"):
        if (out / rel).is_dir():
            shutil.rmtree(out / rel)
    for rel in ("data/manifest.json", "data/bundle.js"):
        if (out / rel).is_file():
            (out / rel).unlink()
    if (out / "data").is_dir():   # a previous Excel export (only workbooks ReportKit wrote)
        from .excel import is_reportkit_xlsx
        for x in (out / "data").glob("*.xlsx"):
            if is_reportkit_xlsx(x):
                x.unlink()
    if idx.exists():
        idx.unlink()


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def _copy_tree(src: Path, dst: Path) -> None:
    """Copy a folder (sorted, skipping dotfiles)."""
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        rel = Path(root).relative_to(src)
        (dst / rel).mkdir(parents=True, exist_ok=True)
        for f in sorted(files):
            if not f.startswith("."):
                shutil.copyfile(Path(root) / f, dst / rel / f)


def _read_text(path: Path) -> str:
    text = path.read_text(encoding="utf-8-sig")
    return text if text.endswith("\n") else text + "\n"


def _concat_js(kit: Kit, p: BuildPlan) -> str:
    head = (f"/*! ReportKit {p.version} | built {p.build_date} | generated by the reportkit Python builder "
            f"from kit/build.json — do not edit by hand */\n")
    chunks = [head]
    for rel in kit.core_files:
        src = kit.kit_dir / rel
        if not src.is_file():
            raise BuildError(f"kit/{rel} (listed in kit/build.json) does not exist")
        chunks.append(f"\n/* ==== kit/{rel} ==== */\n")
        chunks.append(_read_text(src))
    return "".join(chunks)


def _concat_css(kit: Kit, p: BuildPlan) -> str:
    head = f"/*! ReportKit {p.version} | built {p.build_date} | core styles + themes + used components */\n"
    chunks = [head]
    for rel in kit.style_files:
        src = kit.kit_dir / rel
        if not src.is_file():
            raise BuildError(f"kit/{rel} (listed in kit/build.json) does not exist")
        chunks.append(f"\n/* ==== kit/{rel} ==== */\n")
        chunks.append(_read_text(src))
    for cid in p.components:
        css = kit.component_css(cid)
        if css:
            chunks.append(f"\n/* ==== kit/components/{cid}/{cid}.css ==== */\n")
            chunks.append(_read_text(css))
    return "".join(chunks)


# ---------------------------------------------------------------------------------------------
# Single-file output (B1)
# ---------------------------------------------------------------------------------------------
_SCRIPT_BREAKERS = re.compile(r"<(?=/script|!--)", re.I)
_STYLE_BREAKERS = re.compile(r"</(?=style)", re.I)
_CSS_URL = re.compile(r"""/\*.*?\*/|url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s][^)\s]*))\s*\)""", re.I | re.S)
_MIME = {".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
         ".png": "image/png", ".svg": "image/svg+xml", ".gif": "image/gif", ".jpg": "image/jpeg",
         ".jpeg": "image/jpeg", ".webp": "image/webp", ".cur": "image/x-icon", ".ico": "image/x-icon"}


def inline_script_text(js: str) -> str:
    """JS / JSON text safe inside an inline <script>: '</script' and '<!--' get their '<' as the escape
    '\\u003c' (valid in JS strings, template literals, regex literals and JSON strings — the only
    places those sequences occur in real code); raw U+2028 / U+2029 become escapes too."""
    js = _SCRIPT_BREAKERS.sub(r"\\u003c", js)
    return js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def inline_style_text(css: str) -> str:
    """CSS text safe inside an inline <style>: '</style' -> '<\\/style' (a CSS escape of '/')."""
    return _STYLE_BREAKERS.sub(r"<\\/", css)


def report_slug(report: "Report") -> str:
    from .template import fallback_text
    return slugify(fallback_text(report.title)) or "report"


def _source_for(kit: Kit, p: BuildPlan, vpath: str) -> Path | None:
    """Map a path of the report folder layout (assets/fonts/..., assets/vendor/<id>/...) to its source."""
    parts = vpath.split("/")
    if parts[:2] == ["assets", "fonts"] and len(parts) > 2:
        return kit.fonts_dir.joinpath(*parts[2:])
    if parts[:2] == ["assets", "vendor"] and len(parts) > 3 and parts[2] in {v["id"] for v in p.vendor}:
        return kit.vendor_dir.joinpath(*parts[2:])
    return None


def _data_uri(path: Path) -> str:
    mime = _MIME.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _inline_css_urls(css: str, base_dir: str, kit: Kit, p: BuildPlan, where: str) -> str:
    """Replace url(relative) references with data: URIs (fonts, vendor images)."""
    from urllib.parse import unquote

    def sub(m: re.Match) -> str:
        if m.group(0).startswith("/*"):   # comments are left alone
            return m.group(0)
        url = next(g for g in m.groups() if g is not None).strip()
        low = url.lower()
        if not url or low.startswith(("data:", "#", "http:", "https:", "//", "about:", "blob:")):
            return m.group(0)
        clean = unquote(url.split("#", 1)[0].split("?", 1)[0])
        vpath = posixpath.normpath(posixpath.join(base_dir, clean))
        src = _source_for(kit, p, vpath)
        if src is None or not src.is_file():
            raise BuildError(f"single-file build: {where} references url({url}) which cannot be inlined "
                             f"({vpath} not found)")
        return f'url("{_data_uri(src)}")'

    return _CSS_URL.sub(sub, css)


def _inline_assets(kit: Kit, report: "Report", p: BuildPlan, data_source: str) -> dict[str, str]:
    """{href: inline text} for every stylesheet / script index.html references."""
    assets: dict[str, str] = {}
    for pkg in p.vendor:
        for f in Kit.vendor_files(pkg, ".css"):
            href = _href("assets/vendor", pkg["id"], f)
            src = kit.vendor_dir / pkg["id"] / f
            if not src.is_file():
                raise BuildError(f"vendor/{pkg['id']}/{f} is missing — run: python3 tools/vendor.py {pkg['id']}")
            css = _inline_css_urls(_read_text(src), posixpath.dirname(f"assets/vendor/{pkg['id']}/{f}"),
                                   kit, p, f"vendor/{pkg['id']}/{f}")
            assets[href] = inline_style_text(css)
        for f in Kit.vendor_files(pkg, ".js"):
            src = kit.vendor_dir / pkg["id"] / f
            if not src.is_file():
                raise BuildError(f"vendor/{pkg['id']}/{f} is missing — run: python3 tools/vendor.py {pkg['id']}")
            assets[_href("assets/vendor", pkg["id"], f)] = inline_script_text(_read_text(src))
    css = _report_css(kit, report, p)
    assets["assets/css/reportkit.css"] = inline_style_text(_inline_css_urls(css, "assets/css", kit, p, "reportkit.css"))
    assets["assets/js/reportkit.js"] = inline_script_text(_concat_js(kit, p))
    for cid, href in zip(p.components, p.component_js):
        src = kit.component_js(cid)
        if not src.is_file():
            raise BuildError(f"kit/components/{cid}/{cid}.js does not exist")
        assets[href] = inline_script_text(_read_text(src))
    if data_source == "bundle":
        assets["data/bundle.js"] = inline_script_text(bundle_js_text(report.manifest(), report.datasets))
    return assets


def _report_css(kit: Kit, report: "Report", p: BuildPlan) -> str:
    css = _concat_css(kit, p)
    page_size = getattr(report, "page_size", "16:9")
    if page_size != "16:9":
        from .report import PAGE_SIZES
        css += f"\n/* ==== page size: {page_size} ==== */\n@page {{ size: {PAGE_SIZES[page_size]}; margin: 0; }}\n"
    return css


def _single_file_target(report: "Report", out_dir: str | os.PathLike) -> Path:
    out = Path(out_dir)
    if out.suffix.lower() in (".html", ".htm"):
        return out.resolve()
    return (out / f"{report_slug(report)}.html").resolve()


def build(report: "Report", out_dir: str | os.PathLike, *, clean: bool = True, validate: bool = True,
          kit: Any = None, build_date: Any = None, data_source: str = "bundle", api: str | None = None,
          single_file: bool = False, excel: bool = False) -> Path:
    """Validate (optional) and write *report* to *out_dir*. Returns the folder path
    (single_file=True: the path of the one HTML file).

    data_source: 'bundle' (default, opens from file://), 'http' (data/*.json fetched over a web server)
    or 'api' (the page fetches {api}manifest and {api}datasets/<id> — same JSON shapes as data/).
    single_file: write one self-contained HTML file — CSS, fonts (data: URIs), vendor libraries, runtime,
    components and the data bundle inlined — to ``<out_dir>/<slug>.html`` (or *out_dir* if it ends in .html).
    excel: also write ``data/<slug>.xlsx`` (single-file: ``<slug>.xlsx`` next to the HTML), one styled
    sheet per dataset; needs openpyxl."""
    if data_source not in ("bundle", "http", "api"):
        raise BuildError(f"data_source must be 'bundle', 'http' or 'api', got {data_source!r}")
    if data_source == "api" and not api:
        raise BuildError("data_source='api' needs api='https://host/api/reports/<id>/'")
    if single_file and data_source == "http":
        raise BuildError("single_file=True has no data/ folder to fetch: use data_source='bundle' (default) or 'api'")
    if excel:
        from .excel import _require_openpyxl
        _require_openpyxl()   # fail before writing anything
    from .render import render_index

    kit = get_kit(kit)
    if validate:
        for w in _validate(report, kit):
            _warnings.warn(w, ReportKitWarning, stacklevel=3)
    bad = [did for did in report.datasets if not DATASET_ID_RE.fullmatch(did)]
    if bad:
        raise BuildError(f"invalid dataset id(s) for a file name: {', '.join(map(repr, bad))}")
    p = plan(report, kit, build_date=build_date)

    if single_file:
        target = _single_file_target(report, out_dir)
        if target.is_dir():
            raise BuildError(f"{target} is a folder")
        if target.exists() and clean and not _is_report_index(target):
            raise BuildError(f"refusing to overwrite {target}: not written by ReportKit "
                             "(choose another file name, or pass clean=False)")
        excel_href = None
        if excel:
            xlsx = target.with_suffix(".xlsx")
            if xlsx.exists() and clean:
                from .excel import is_reportkit_xlsx
                if not is_reportkit_xlsx(xlsx):
                    raise BuildError(f"refusing to overwrite {xlsx}: not written by ReportKit")
            from .excel import write_workbook
            write_workbook(report, xlsx, build_date=p.build_date)
            excel_href = _href(xlsx.name)
        html = render_index(report, p, data_source=data_source, api=api,
                            inline=_inline_assets(kit, report, p, data_source), excel_href=excel_href)
        _write(target, html)
        return target

    out = Path(out_dir).resolve()
    _prepare_out(out, clean)

    # assets/js + assets/css
    _write(out / "assets/js/reportkit.js", _concat_js(kit, p))
    _write(out / "assets/css/reportkit.css", _report_css(kit, report, p))
    for cid in p.components:
        src = kit.component_js(cid)
        if not src.is_file():
            raise BuildError(f"kit/components/{cid}/{cid}.js does not exist")
        (out / "assets/js/components").mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, out / "assets/js/components" / f"{cid}.js")

    # assets/vendor/<id>/ (whole folder: dist files + LICENSE / NOTICE)
    for pkg in p.vendor:
        src = kit.vendor_dir / pkg["id"]
        if not src.is_dir():
            raise BuildError(f"vendor/{pkg['id']}/ is missing — run: python3 tools/vendor.py {pkg['id']}")
        _copy_tree(src, out / "assets/vendor" / pkg["id"])
    if p.vendor and (kit.vendor_dir / "LICENSES.md").is_file():  # third-party notices summary
        shutil.copyfile(kit.vendor_dir / "LICENSES.md", out / "assets/vendor/LICENSES.md")

    if kit.fonts_dir.is_dir():
        _copy_tree(kit.fonts_dir, out / "assets/fonts")

    # data/
    (out / "data/datasets").mkdir(parents=True, exist_ok=True)
    manifest = report.manifest()
    _write(out / "data/manifest.json", dumps(manifest, indent=2) + "\n")
    for did, ds in report.datasets.items():
        _write(out / "data/datasets" / f"{did}.json", dataset_json_text(ds) + "\n")
    _write(out / "data/bundle.js", bundle_js_text(manifest, report.datasets))
    excel_href = None
    if excel:
        from .excel import write_workbook
        name = f"{report_slug(report)}.xlsx"
        write_workbook(report, out / "data" / name, build_date=p.build_date)
        excel_href = _href("data", name)

    _write(out / "index.html", render_index(report, p, data_source=data_source, api=api, excel_href=excel_href))
    return out
