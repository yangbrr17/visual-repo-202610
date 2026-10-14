"""Report validation: collect *all* problems, then raise ReportValidationError (architecture.md §4-§6)."""
from __future__ import annotations

import difflib
import numbers
import re
from typing import Any, TYPE_CHECKING

from ._util import as_list
from .data import LARGE_DATASET_ROWS
from .errors import ReportValidationError
from .expr import ExprSyntaxError, formula_refs, norm_name
from .kit import Kit
from .template import check_template

if TYPE_CHECKING:  # pragma: no cover
    from .report import Block, Report

__all__ = ["check", "validate", "get_kit", "DATASET_ID_RE"]

DATASET_ID_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*$")
_CSS_LENGTH_RE = re.compile(r"^\d+(\.\d+)?(px|vh|vw|rem|em|%)$")

# ---- how a component reads its channels (mirrors the component JS; the manifest marks the default form) ----------
# A channel documented as "options.<name> — …" is read from that block option, not from encode (pivot-table rows /
# cols / value); its values are field names or RK row formulas.
_OPTION_CHANNEL_RE = re.compile(r"^\s*options\.(\w+)\b")
_OPTION_CHANNELS = {"pivot-table": {"rows": "rows", "cols": "cols", "value": "value"}}
# A channel documented with "(<name>Data)" binds to the secondary dataset that option names (network node channels
# id / name / category / size -> options.nodesData); without that option the component does not read it.
_SECONDARY_DATA_RE = re.compile(r"\((\w+Data)\)")
_SECONDARY_CHANNELS = {"network": {"id": "nodesData", "name": "nodesData", "category": "nodesData", "size": "nodesData"}}


def _wide(enc: dict, *channels: str) -> bool:
    return any(isinstance(enc.get(c), (list, tuple)) for c in channels)


# Required channels a component does not read in some configurations ("required" = required in the default form).
_WAIVED: dict[tuple[str, str], Any] = {
    ("bump", "x"): lambda enc, opts: _wide(enc, "rank", "value"),        # wide: one rank / value field per period
    ("radar", "value"): lambda enc, opts: _wide(enc, "axis"),            # wide: one numeric field per axis
    ("sources-uses", "side"): lambda enc, opts: opts.get("mode") == "capitalization",   # one list, no panels
}
# Field names a component falls back to when the channel is not mapped (sources-uses: pick([enc.item, 'instrument',
# 'item'])).
_FALLBACK_FIELDS = {("sources-uses", "item"): ("instrument", "item"), ("sources-uses", "amount"): ("amount",)}


def get_kit(kit: Any = None) -> Kit:
    if isinstance(kit, Kit):
        return kit
    if kit is not None:
        return Kit(kit)
    return Kit.locate()


def _suggest(name: str, options: list[str]) -> str:
    close = difflib.get_close_matches(str(name), [str(o) for o in options], n=3, cutoff=0.6)
    return f" — did you mean {', '.join(repr(c) for c in close)}?" if close else ""


def _is_num(v: Any) -> bool:
    return isinstance(v, numbers.Real) and not isinstance(v, bool)


def _field_names(ds: dict) -> list[str]:
    names = [f["name"] for f in (ds.get("schema") or {}).get("fields", [])]
    names += [c["name"] for c in ds.get("computed") or [] if c.get("name") and c["name"] not in names]
    return names


def _encode_values(value: Any) -> list[str] | None:
    """Field names referenced by one encode channel (None = not a field reference we can check)."""
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, (list, tuple)):
        return [v for v in value if isinstance(v, str) and v]
    return None


def check(report: "Report", kit: Any = None) -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for *report* against *kit* (no exception)."""
    kit = get_kit(kit)
    errors: list[str] = list(report._problems)
    warnings: list[str] = list(report._warnings)
    report.resolve_ids()

    # -------------------------------------------------------------- report / kit
    if not report.title:
        errors.append("report title is empty")
    if report.theme not in kit.themes:
        errors.append(f"unknown theme '{report.theme}' (available: {', '.join(kit.themes)})")
    for rel in kit.core_files + kit.style_files:
        if not (kit.kit_dir / rel).is_file():
            errors.append(f"kit: kit/{rel} is listed in kit/build.json but does not exist")
    if not report.pages:
        warnings.append("report has no pages")
    if report.date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(report.date)):
        warnings.append(f"report date {report.date!r} is not ISO 'YYYY-MM-DD' (pass a date or '2026-10-14')")

    # -------------------------------------------------------------- params
    for name, p in report.params.items():
        v, lo, hi = p.get("value"), p.get("min"), p.get("max")
        for key in ("min", "max", "step"):
            if p.get(key) is not None and not _is_num(p[key]):
                errors.append(f"param '{name}': {key} must be a number, got {p[key]!r}")
        if _is_num(lo) and _is_num(hi) and lo > hi:
            errors.append(f"param '{name}': min ({lo}) is greater than max ({hi})")
        if _is_num(v):
            if _is_num(lo) and v < lo or _is_num(hi) and v > hi:
                errors.append(f"param '{name}': value {v} is outside [{lo}, {hi}]")
        elif v is None:
            errors.append(f"param '{name}' has no value")

    # -------------------------------------------------------------- datasets
    for did, ds in report.datasets.items():
        if not DATASET_ID_RE.fullmatch(did):
            errors.append(f"dataset id '{did}' must contain only letters, digits, '_', '-', '.' "
                          "(it becomes data/datasets/<id>.json)")
        n = len(ds.get("data") or [])
        if n > LARGE_DATASET_ROWS:
            warnings.append(f"dataset '{did}' has {n:,} rows (> {LARGE_DATASET_ROWS:,}); every row is shipped "
                            "to the browser — consider pre-aggregating")
        fields = (ds.get("schema") or {}).get("fields", [])
        avail = {norm_name(f["name"]) for f in fields} | {norm_name(f["title"]) for f in fields if f.get("title")}
        for i, c in enumerate(ds.get("computed") or []):
            cname, formula = c.get("name"), c.get("formula")
            where = f"dataset '{did}' computed field '{cname or i}'"
            if not cname or not formula:
                errors.append(f"{where}: needs both 'name' and 'formula'")
                continue
            try:
                params, refs, _funcs = formula_refs(formula)
            except ExprSyntaxError as e:
                errors.append(f"{where}: formula {formula!r} is invalid ({e})")
                continue
            for pname in params:
                if pname not in report.params:
                    errors.append(f"{where}: formula uses @{pname} but no param '{pname}' is defined "
                                  f"(add r.param('{pname}', value)){_suggest(pname, list(report.params))}")
            if any(norm_name(ref) == norm_name(cname) for ref in refs):
                errors.append(f"{where}: formula {formula!r} references its own name — computed fields cannot be "
                              f"self-referential (e.g. 'ev = ev * 1.1'); give the derived field a new name")
                continue
            for ref in refs:
                if norm_name(ref) not in avail:
                    errors.append(f"{where}: formula references unknown field '{ref}'"
                                  f"{_suggest(ref, [f['name'] for f in fields])}")
            avail.add(norm_name(cname))
            if c.get("title"):
                avail.add(norm_name(c["title"]))

    # -------------------------------------------------------------- ids
    seen: dict[str, str] = {}
    for i, p in enumerate(report.pages):
        _check_id(p.explicit_id, f"page {i + 1} '{p.title}'", seen, errors)
    for i, b in enumerate(report.topbar):
        _check_id(b.explicit_id, f"topbar block {i + 1} ({b.component})", seen, errors)
    for i, p in enumerate(report.pages):
        for j, b in enumerate(p.blocks):
            _check_id(b.explicit_id, f"page {i + 1} block {j + 1} ({b.component})", seen, errors)

    # -------------------------------------------------------------- pages & blocks
    from .report import PAGE_KINDS, UPDOWN
    if getattr(report, "updown", None) not in (None, *UPDOWN):
        errors.append(f"report updown {report.updown!r} must be 'us' or 'cn'")
    if not isinstance(report.locale, str) or not re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*", report.locale):
        warnings.append(f"report locale {report.locale!r} is not a BCP 47 tag like 'en-US' or 'zh-CN' "
                        "(<html lang> / rk:locale; the runtime falls back to English)")
    checked_components: dict[str, bool] = {}
    for i, p in enumerate(report.pages):
        where = f"page {i + 1} '{p.title or p.id}'"
        if p.kind not in PAGE_KINDS:
            errors.append(f"{where}: kind '{p.kind}' must be one of {', '.join(PAGE_KINDS)}")
        if not p.title:
            errors.append(f"page {i + 1}: title is empty")
        if not isinstance(getattr(p, "filters", True), bool):
            errors.append(f"{where}: filters must be True or False, got {p.filters!r}")
        page_ds = next((b.data for b in p.blocks if b.data is not None), None)
        for key in ("kicker", "title", "subtitle"):
            for prob in check_template(getattr(p, key), report.datasets, report.params, page_ds):
                errors.append(f"{where} › {key} template: {prob}")
        for b in p.blocks:
            _check_block(report, kit, b, f"{where} › block '{b.id}' [{b.component}]", errors, warnings,
                         checked_components)
    for b in report.topbar:
        _check_block(report, kit, b, f"topbar block '{b.id}' [{b.component}]", errors, warnings,
                     checked_components, topbar=True)
    return errors, warnings


def _check_id(value: str | None, where: str, seen: dict[str, str], errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, str) or not value or re.search(r"\s", value):
        errors.append(f"{where}: id {value!r} must be a non-empty string without spaces")
        return
    if value in seen:
        errors.append(f"duplicate id '{value}' ({seen[value]} and {where})")
    else:
        seen[value] = where


def _check_component_files(kit: Kit, cid: str, manifest: dict, errors: list[str]) -> None:
    if not kit.component_js(cid).is_file():
        errors.append(f"kit: component '{cid}' has a manifest but no kit/components/{cid}/{cid}.js")
    for dep in Kit.option_dep_ids(manifest):
        if kit.vendor_package(dep) is None:
            errors.append(f"kit: component '{cid}' optionDeps names unknown vendor package '{dep}' "
                          f"(not in vendor/vendor.json){_suggest(dep, [p.get('id', '') for p in kit.vendor_packages])}")
    for dep in manifest.get("deps") or []:
        pkg = kit.vendor_package(dep)
        if pkg is None:
            errors.append(f"kit: component '{cid}' depends on unknown vendor package '{dep}' "
                          f"(not in vendor/vendor.json){_suggest(dep, [p.get('id', '') for p in kit.vendor_packages])}")
            continue
    _check_vendor_files(kit, [d for d in manifest.get("deps") or [] if kit.vendor_package(d)], errors)


def _check_vendor_files(kit: Kit, ids: list[str], errors: list[str]) -> None:
    for pkg in kit.resolve_vendor(ids):
        base = kit.vendor_dir / pkg["id"]
        files = pkg.get("files") or {}
        dests = list(files.values()) if isinstance(files, dict) else list(files)
        missing = [d for d in dests if isinstance(d, str) and not (base / d.rstrip("/")).exists()]
        if not base.is_dir() or missing:
            errors.append(f"kit: vendor/{pkg['id']}/ is incomplete (missing {', '.join(missing) or 'folder'}) — "
                          "run python3 tools/vendor.py")


def _check_block(report: "Report", kit: Kit, b: "Block", where: str, errors: list[str],
                 warnings: list[str], checked: dict[str, bool], topbar: bool = False) -> None:
    if not topbar:
        if not isinstance(b.span, int) or isinstance(b.span, bool) or not 1 <= b.span <= 12:
            errors.append(f"{where}: span must be an integer 1-12, got {b.span!r}")
        h = b.height
        if h is not None and h != "auto" and not ((_is_num(h) and h > 0) or (isinstance(h, str) and _CSS_LENGTH_RE.match(h))):
            errors.append(f"{where}: height must be a positive number of px, a CSS length like '50vh', or 'auto', got {h!r}")

    manifest = kit.component(b.component)
    if manifest is None:
        errors.append(f"{where}: unknown component '{b.component}' (no kit/components/{b.component}/manifest.json)"
                      f"{_suggest(b.component, kit.component_ids())}")
        return
    if b.component not in checked:
        checked[b.component] = True
        _check_component_files(kit, b.component, manifest, errors)
    for dep in Kit.option_deps(manifest, b.options):   # vendor files pulled in by this block's options
        if kit.vendor_package(dep) is not None and f"vendor:{dep}" not in checked:
            checked[f"vendor:{dep}"] = True
            _check_vendor_files(kit, [dep], errors)
    if not topbar:
        for key in ("title", "subtitle"):
            for prob in check_template(getattr(b, key), report.datasets, report.params, b.data):
                errors.append(f"{where} › {key} template: {prob}")

    needs = Kit.needs_data(manifest)
    ds = None
    if b.data is not None:
        ds = report.datasets.get(b.data)
        if ds is None:
            errors.append(f"{where}: unknown dataset '{b.data}'{_suggest(b.data, list(report.datasets))}")
    elif needs:
        errors.append(f"{where}: component '{b.component}' needs data — pass data='<dataset id>'")

    for key, val in sorted(b.options.items()):
        if key.endswith("Data") and isinstance(val, str) and val not in report.datasets:
            errors.append(f"{where}: options.{key} refers to unknown dataset '{val}'"
                          f"{_suggest(val, list(report.datasets))}")

    if ds is None:
        return
    names = _field_names(ds)
    choices = b.options.get("choices")
    choice_fields: dict[str, list[str]] = {}
    if choices is not None:
        if not isinstance(choices, dict):
            errors.append(f"{where}: options.choices must be {{channel: [field, ...]}}, got {type(choices).__name__}")
        else:
            for ch, fields in choices.items():
                if not isinstance(fields, list) or not fields:
                    errors.append(f"{where}: options.choices.{ch} must be a non-empty list of field names "
                                  "(or '*computed')")
                    continue
                for f in fields:
                    if not isinstance(f, str) or not f:
                        errors.append(f"{where}: options.choices.{ch} entries must be field names, got {f!r}")
                    elif f.startswith("*"):
                        if f != "*computed":
                            errors.append(f"{where}: options.choices.{ch}: unknown wildcard {f!r} (only '*computed')")
                    elif f not in names:
                        errors.append(f"{where}: options.choices.{ch} -> field '{f}' is not in dataset '{b.data}'"
                                      f"{_suggest(f, names)}")
                    else:
                        choice_fields.setdefault(ch, []).append(f)
    enc = b.encode
    channels = manifest.get("channels") or {}
    if not isinstance(channels, dict):
        channels = {}
    option_channels, secondary = _channel_bindings(b.component, manifest, channels)

    for ch, val in enc.items():
        refs = _encode_values(val)
        if ch in secondary:   # bound to the dataset named by options.<secondary[ch]>, checked below
            continue
        for ref in refs or []:
            if ref not in names:
                errors.append(f"{where}: encode.{ch} -> field '{ref}' is not in dataset '{b.data}'"
                              f"{_suggest(ref, names) or ' (fields: ' + ', '.join(names) + ')'}")
    for ch, opt in secondary.items():
        sid = b.options.get(opt)
        sds = report.datasets.get(sid) if isinstance(sid, str) else None
        refs = _encode_values(enc.get(ch))
        if sds is None or not refs:   # no node table: the component derives nodes from the edges
            continue
        snames = _field_names(sds)
        for ref in refs:
            if ref not in snames:
                errors.append(f"{where}: encode.{ch} -> field '{ref}' is not in dataset '{sid}' (options.{opt})"
                              f"{_suggest(ref, snames) or ' (fields: ' + ', '.join(snames) + ')'}")
    for ch, opt in option_channels.items():
        if opt in b.options:
            _check_field_refs(b.options.get(opt), f"options.{opt}", ds, b.data, where, errors)

    for ch, spec in channels.items():
        if not isinstance(spec, dict) or not spec.get("required") or ch in secondary:
            continue
        waived = _WAIVED.get((b.component, ch))
        if waived is not None and waived(enc, b.options):
            continue
        if ch in option_channels:
            if option_channels[ch] in b.options and as_list(b.options.get(option_channels[ch])):
                continue
        else:
            mapped = _encode_values(enc.get(ch))
            if mapped or (enc.get(ch) is not None and mapped is None) or choice_fields.get(ch):
                continue
        default = spec.get("default")
        candidates = [d for d in as_list(default) if isinstance(d, str)] if default else []
        if candidates and all(c in names for c in candidates):
            continue
        if ch in names or any(f in names for f in _FALLBACK_FIELDS.get((b.component, ch), ())):
            continue
        hint = f" and its default field '{default}' is not in the dataset" if default else ""
        how = (f"options={{'{option_channels[ch]}': '<field or formula>'}}" if ch in option_channels
               else f"encode={{'{ch}': '<field>'}}")
        errors.append(f"{where}: required channel '{ch}' is not mapped — add {how}"
                      f"{hint} (dataset '{b.data}' fields: {', '.join(names)})")


def _channel_bindings(component: str, manifest: dict, channels: dict) -> tuple[dict[str, str], dict[str, str]]:
    """({channel: option read instead of encode}, {channel: option naming the secondary dataset it binds to})."""
    opts = manifest.get("options") if isinstance(manifest.get("options"), dict) else {}
    option_channels: dict[str, str] = dict(_OPTION_CHANNELS.get(component, {}))
    secondary: dict[str, str] = dict(_SECONDARY_CHANNELS.get(component, {}))
    for ch, spec in channels.items():
        desc = str(spec.get("desc") or "") if isinstance(spec, dict) else ""
        m = _OPTION_CHANNEL_RE.match(desc)
        if m:
            option_channels[ch] = m.group(1)
            continue
        m = _SECONDARY_DATA_RE.search(desc)
        if m and m.group(1) in opts:
            secondary.setdefault(ch, m.group(1))
    return option_channels, secondary


def _check_field_refs(value: Any, where_opt: str, ds: dict, did: str | None, where: str,
                      errors: list[str]) -> None:
    """Values of an option-channel: field names or RK row formulas (e.g. 'year(date)'); null / [] are allowed."""
    names = _field_names(ds)
    avail = {norm_name(n) for n in names}
    avail |= {norm_name(f["title"]) for f in (ds.get("schema") or {}).get("fields", []) if f.get("title")}
    for v in as_list(value):
        if not isinstance(v, str):
            errors.append(f"{where}: {where_opt} entries must be field names or formulas, got {v!r}")
            continue
        if v in names:
            continue
        try:
            _params, refs, _funcs = formula_refs(v)
        except ExprSyntaxError as e:
            errors.append(f"{where}: {where_opt} -> {v!r} is neither a field of dataset '{did}' nor a valid formula ({e})")
            continue
        for ref in refs:
            if norm_name(ref) not in avail:
                errors.append(f"{where}: {where_opt} -> field '{ref}' is not in dataset '{did}'"
                              f"{_suggest(ref, names) or ' (fields: ' + ', '.join(names) + ')'}")


def validate(report: "Report", kit: Any = None) -> list[str]:
    errors, warnings = check(report, kit)
    if errors:
        raise ReportValidationError(errors, warnings)
    return warnings
