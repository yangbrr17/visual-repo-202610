"""Write the self-contained report folder (architecture.md §3)."""
from __future__ import annotations

import datetime as _dt
import json
import os
import shutil
import warnings as _warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TYPE_CHECKING

from ._util import dumps
from .errors import BuildError
from .kit import Kit
from .validate import DATASET_ID_RE, get_kit, validate as _validate

if TYPE_CHECKING:  # pragma: no cover
    from .report import Report

__all__ = ["build", "plan", "BuildPlan", "dataset_json_text", "bundle_js_text", "ReportKitWarning"]


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
    return "RK.data.preload(" + body + ");\n"


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
    for name, _ in checks:
        if (out / name).exists():
            shutil.rmtree(out / name)
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


def build(report: "Report", out_dir: str | os.PathLike, *, clean: bool = True, validate: bool = True,
          kit: Any = None, build_date: Any = None) -> Path:
    """Validate (optional) and write *report* to *out_dir*. Returns the folder path."""
    from .render import render_index

    kit = get_kit(kit)
    if validate:
        for w in _validate(report, kit):
            _warnings.warn(w, ReportKitWarning, stacklevel=3)
    bad = [did for did in report.datasets if not DATASET_ID_RE.match(did)]
    if bad:
        raise BuildError(f"invalid dataset id(s) for a file name: {', '.join(map(repr, bad))}")
    p = plan(report, kit, build_date=build_date)
    out = Path(out_dir).resolve()
    _prepare_out(out, clean)

    # assets/js + assets/css
    _write(out / "assets/js/reportkit.js", _concat_js(kit, p))
    _write(out / "assets/css/reportkit.css", _concat_css(kit, p))
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

    _write(out / "index.html", render_index(report, p))
    return out
