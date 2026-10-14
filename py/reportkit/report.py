"""Report / Page / Block — the analyst-facing API, plus the JSON layout spec (to_spec / from_spec)."""
from __future__ import annotations

import copy
import json
import os
import re
from pathlib import Path
from typing import Any, Iterator

from ._util import dumps, iso_date, slugify, unique_id
from .data import normalize_dataset, to_json_value
from .errors import ReportKitError

__all__ = ["Report", "Page", "Block", "SpecError", "SPEC_VERSION", "CONTRACT_VERSION", "PAGE_KINDS"]

CONTRACT_VERSION = "0.1"   # "reportkit" key of data/manifest.json (architecture.md §4.2)
SPEC_VERSION = "0.1"       # "reportkit" key of the JSON layout spec
PAGE_KINDS = ("content", "cover", "section")
DEFAULT_CONFIDENTIALITY = "Strictly private & confidential"


class SpecError(ReportKitError, ValueError):
    """The JSON layout spec is malformed (unknown keys, wrong types...)."""


def _clean_options(options: Any) -> dict:
    if options is None:
        return {}
    if not isinstance(options, dict):
        raise TypeError(f"options must be a dict, got {type(options).__name__}")
    return to_json_value(copy.deepcopy(options))


class Block:
    """One component mount (``<figure class="rk-block">``) on a page, or a top-bar control."""

    def __init__(self, component: str, *, data: str | None = None, title: str | None = None,
                 subtitle: str | None = None, span: int = 12, height: Any = None,
                 options: dict | None = None, encode: dict | None = None, source: str | None = None,
                 notes: Any = None, id: str | None = None, page: "Page | None" = None):
        if not isinstance(component, str) or not component:
            raise TypeError("component must be a non-empty string (a kit/components/<id> name)")
        self.component = component
        self.data = data
        self.title = title
        self.subtitle = subtitle
        self.span = span
        self.height = height
        self.options = _clean_options(options)
        if encode:
            if not isinstance(encode, dict):
                raise TypeError("encode must be a dict {channel: field}")
            enc = dict(self.options.get("encode") or {})
            enc.update(to_json_value(encode))
            self.options["encode"] = enc
        self.source = source
        self.notes = notes
        self.explicit_id = id
        self.page = page
        self._rid: str | None = None

    @property
    def id(self) -> str | None:
        """Explicit id, or the auto id assigned when the report is validated / built."""
        return self.explicit_id or self._rid

    @property
    def encode(self) -> dict:
        enc = self.options.get("encode")
        return enc if isinstance(enc, dict) else {}

    def __repr__(self) -> str:
        return f"Block({self.component!r}, data={self.data!r}, id={self.id!r})"

    def to_spec(self, *, topbar: bool = False) -> dict:
        out: dict[str, Any] = {"component": self.component}
        if self.data is not None:
            out["data"] = self.data
        if not topbar:
            for key in ("title", "subtitle"):
                if getattr(self, key) is not None:
                    out[key] = getattr(self, key)
            if self.span != 12:
                out["span"] = self.span
            if self.height is not None:
                out["height"] = self.height
        if self.options:
            out["options"] = copy.deepcopy(self.options)
        if not topbar:
            if self.source is not None:
                out["source"] = self.source
            if self.notes is not None:
                out["notes"] = self.notes
        if self.explicit_id:
            out["id"] = self.explicit_id
        return out


class Page:
    """A 16:9 page (``<section class="rk-page">``). Create with :meth:`Report.page`."""

    def __init__(self, report: "Report", title: str, *, kicker: str | None = None,
                 subtitle: str | None = None, source: Any = None, notes: Any = None,
                 id: str | None = None, kind: str = "content", nav: str | None = None,
                 num: str | None = None):
        self.report = report
        self.title = title
        self.kicker = kicker
        self.subtitle = subtitle
        self.source = source
        self.notes = notes
        self.explicit_id = id
        self.kind = kind
        self.nav = nav
        self.num = num
        self.blocks: list[Block] = []
        self._rid: str | None = None

    @property
    def id(self) -> str | None:
        return self.explicit_id or self._rid

    def __repr__(self) -> str:
        return f"Page({self.title!r}, kind={self.kind!r}, blocks={len(self.blocks)})"

    def block(self, component: str, *, data: Any = None, title: str | None = None,
              subtitle: str | None = None, span: int = 12, height: Any = None,
              options: dict | None = None, encode: dict | None = None, source: str | None = None,
              notes: Any = None, id: str | None = None) -> Block:
        """Add a component block. *data* is a dataset id — or a DataFrame / records, which are
        registered as a dataset automatically (id derived from the block id / title)."""
        if data is not None and not isinstance(data, str):
            data = self.report._auto_dataset(data, id or title or component)
        b = Block(component, data=data, title=title, subtitle=subtitle, span=span, height=height,
                  options=options, encode=encode, source=source, notes=notes, id=id, page=self)
        self.blocks.append(b)
        return b

    def to_spec(self) -> dict:
        out: dict[str, Any] = {"title": self.title}
        if self.kind != "content":
            out["kind"] = self.kind
        for key in ("kicker", "subtitle", "source", "notes", "nav", "num"):
            if getattr(self, key) is not None:
                out[key] = getattr(self, key)
        if self.explicit_id:
            out["id"] = self.explicit_id
        out["blocks"] = [b.to_spec() for b in self.blocks]
        return out


class Report:
    """An interactive client report.

    >>> r = Report("Project Atlas", subtitle="Discussion materials", client="Board of Directors",
    ...            date="2026-10-14", firm="Northbridge Partners")
    >>> r.dataset("comps", df, source="FactSet", fields={"ev_ebitda": {"title": "EV/EBITDA", "format": "0.0x"}})
    >>> p = r.page("Peers trade at 9.5x EBITDA", kicker="Trading comparables")
    >>> p.block("bar", data="comps", encode={"x": "company", "y": "ev_ebitda"}, span=7)
    >>> r.build("out/atlas")
    """

    def __init__(self, title: str, subtitle: str | None = None, client: str | None = None,
                 date: Any = None, theme: str = "navy",
                 confidentiality: str | None = DEFAULT_CONFIDENTIALITY, locale: str = "en-US",
                 firm: str | None = None):
        self.title = title
        self.subtitle = subtitle
        self.client = client
        self.date = iso_date(date)
        self.theme = theme
        self.confidentiality = confidentiality
        self.locale = locale or "en-US"
        self.firm = firm
        self.datasets: dict[str, dict] = {}
        self.params: dict[str, dict] = {}
        self.pages: list[Page] = []
        self.topbar: list[Block] = []
        self._problems: list[str] = []   # recorded at call time, reported by validate()
        self._warnings: list[str] = []
        self._dataset_args: dict[str, dict] = {}

    def __repr__(self) -> str:
        return (f"Report({self.title!r}, pages={len(self.pages)}, datasets={len(self.datasets)}, "
                f"params={len(self.params)})")

    # ------------------------------------------------------------------ data
    def dataset(self, id: str, data: Any, *, title: str | None = None, fields: Any = None,
                source: str | None = None, notes: Any = None, unit: str | None = None,
                as_of: Any = None, computed: Any = None) -> str:
        """Register a dataset and return its id.

        data: pandas DataFrame | list[dict] | dict[str, list] | contract-form dict |
              path to .csv / .json / .parquet / .xlsx (parquet / xlsx need pandas).
        fields: {"ev_ebitda": {"title": "EV/EBITDA", "format": "0.0x"}} (or {"name": "Title"}).
        computed: [{"name": "margin", "formula": "ebitda / revenue", "format": "0.0%"}]
                  or {"margin": "ebitda / revenue"}; formulas may use @params.
        """
        if not isinstance(id, str) or not id:
            raise TypeError("dataset id must be a non-empty string")
        if isinstance(data, (str, os.PathLike)) and not isinstance(data, Path):
            data = Path(data)
        ds, warns = normalize_dataset(id, data, title=title, fields=fields, source=source, notes=notes,
                                      unit=unit, as_of=as_of, computed=computed)
        if id in self.datasets:
            self._problems.append(f"duplicate dataset id '{id}' (defined more than once)")
        self.datasets[id] = ds
        self._warnings.extend(warns)
        return id

    def _auto_dataset(self, data: Any, hint: str) -> str:
        base = slugify(hint, 32) or "data"
        did = unique_id(base, set(self.datasets))
        return self.dataset(did, data)

    def param(self, name: str, value: Any, *, min: Any = None, max: Any = None, step: Any = None,
              format: str | None = None, title: str | None = None) -> str:
        """Define a what-if parameter (``@name`` in formulas); returns the name."""
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z_]\w*", name):
            raise ValueError(f"param name {name!r} must be an identifier (letters, digits, _)")
        if name in self.params:
            self._problems.append(f"duplicate param '{name}' (defined more than once)")
        spec = {"value": to_json_value(value), "min": to_json_value(min), "max": to_json_value(max),
                "step": to_json_value(step), "format": format, "title": title}
        # definition order is kept everywhere (a params panel shows sliders in this order)
        self.params[name] = {k: v for k, v in spec.items() if v is not None or k == "value"}
        return name

    # ------------------------------------------------------------------ layout
    def page(self, title: str, *, kicker: str | None = None, subtitle: str | None = None,
             source: Any = None, notes: Any = None, id: str | None = None, kind: str = "content",
             nav: str | None = None, num: str | None = None) -> Page:
        """Add a page. kind: "content" (default), "cover" or "section" (divider)."""
        p = Page(self, title, kicker=kicker, subtitle=subtitle, source=source, notes=notes, id=id,
                 kind=kind, nav=nav, num=num)
        self.pages.append(p)
        return p

    def cover(self, title: str | None = None, *, subtitle: str | None = None,
              kicker: str | None = None, id: str | None = None, nav: str | None = None) -> Page:
        """Shortcut for a cover page; title / subtitle default to the report's."""
        return self.page(title or self.title, kicker=kicker,
                         subtitle=subtitle if subtitle is not None else self.subtitle,
                         id=id, kind="cover", nav=nav)

    def section(self, title: str, *, num: str | None = None, subtitle: str | None = None,
                id: str | None = None, nav: str | None = None) -> Page:
        """Shortcut for a section divider page (auto-numbered 01, 02 ... unless *num* is given)."""
        return self.page(title, subtitle=subtitle, id=id, kind="section", nav=nav, num=num)

    def topbar_block(self, component: str, *, options: dict | None = None, data: Any = None,
                     encode: dict | None = None, id: str | None = None) -> Block:
        """Mount a component in the sticky top bar (e.g. a global "filter-bar")."""
        if data is not None and not isinstance(data, str):
            data = self._auto_dataset(data, id or component)
        b = Block(component, data=data, options=options, encode=encode, id=id)
        self.topbar.append(b)
        return b

    def iter_blocks(self) -> Iterator[Block]:
        yield from self.topbar
        for p in self.pages:
            yield from p.blocks

    # ------------------------------------------------------------------ ids
    def resolve_ids(self) -> None:
        """Assign deterministic auto ids (pages: slug of kicker/title; blocks: page-id + slug)."""
        used: set[str] = set()
        for p in self.pages:
            if p.explicit_id:
                used.add(p.explicit_id)
        for b in self.iter_blocks():
            if b.explicit_id:
                used.add(b.explicit_id)
        for i, p in enumerate(self.pages):
            p._rid = None
            if not p.explicit_id:
                base = "cover" if p.kind == "cover" else slugify(p.kicker or p.title) or f"page-{i + 1}"
                p._rid = unique_id(base, used)
        for b in self.topbar:
            b._rid = None if b.explicit_id else unique_id(f"topbar-{b.component}", used)
        for p in self.pages:
            for b in p.blocks:
                if not b.explicit_id:
                    b._rid = unique_id(f"{p.id}-{slugify(b.title, 32) or b.component}", used)

    # ------------------------------------------------------------------ outputs
    def report_meta(self) -> dict:
        meta = {"title": self.title, "subtitle": self.subtitle, "client": self.client, "date": self.date,
                "confidentiality": self.confidentiality, "locale": self.locale, "firm": self.firm,
                "theme": self.theme}
        return {k: v for k, v in meta.items() if v is not None}

    def manifest(self) -> dict:
        """Content of data/manifest.json (architecture.md §4.2)."""
        return {
            "reportkit": CONTRACT_VERSION,
            "report": self.report_meta(),
            "datasets": {did: {"path": f"datasets/{did}.json", "title": ds.get("title") or did,
                               "rows": len(ds.get("data") or [])}
                         for did, ds in self.datasets.items()},
            "params": copy.deepcopy(self.params),
        }

    def check(self, kit: Any = None) -> tuple[list[str], list[str]]:
        """Return (errors, warnings) without raising."""
        from .validate import check
        return check(self, kit)

    def validate(self, kit: Any = None) -> list[str]:
        """Raise ReportValidationError listing *every* problem; return the warnings otherwise."""
        from .validate import validate
        return validate(self, kit)

    def html(self, kit: Any = None, *, build_date: str | None = None) -> str:
        """The index.html text (no files written)."""
        from .build import plan
        from .render import render_index
        return render_index(self, plan(self, kit, build_date=build_date))

    def build(self, out_dir: str | os.PathLike, *, clean: bool = True, validate: bool = True,
              kit: Any = None, build_date: str | None = None, data_source: str = "bundle",
              api: str | None = None) -> Path:
        """Write the self-contained report folder; returns its path (open ``<path>/index.html``).

        data_source='bundle' (default, works from file://) | 'http' | 'api' (with api='https://.../')."""
        from .build import build
        return build(self, out_dir, clean=clean, validate=validate, kit=kit, build_date=build_date,
                     data_source=data_source, api=api)

    # ------------------------------------------------------------------ spec
    def to_spec(self, base_dir: str | os.PathLike | None = None) -> dict:
        """JSON layout spec. With *base_dir*, datasets are written to ``<base_dir>/datasets/<id>.json``
        and referenced by relative path; otherwise they are inlined (contract form)."""
        datasets: dict[str, Any] = {}
        for did, ds in self.datasets.items():
            if base_dir is not None:
                rel = f"datasets/{did}.json"
                path = Path(base_dir) / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                from .build import dataset_json_text
                path.write_text(dataset_json_text(ds), encoding="utf-8", newline="\n")
                datasets[did] = {"path": rel}
            else:
                datasets[did] = copy.deepcopy(ds)
        spec: dict[str, Any] = {
            "reportkit": SPEC_VERSION,
            "report": self.report_meta(),
            "params": copy.deepcopy(self.params),
            "datasets": datasets,
        }
        if self.topbar:
            spec["topbar"] = [b.to_spec(topbar=True) for b in self.topbar]
        spec["pages"] = [p.to_spec() for p in self.pages]
        return spec

    def save_spec(self, path: str | os.PathLike) -> Path:
        """Write the spec to *path* and the datasets next to it (``datasets/<id>.json``)."""
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        spec = self.to_spec(base_dir=path.parent)
        path.write_text(dumps(spec, indent=2) + "\n", encoding="utf-8", newline="\n")
        return path

    @classmethod
    def from_spec(cls, spec: dict | str | os.PathLike, base_dir: str | os.PathLike | None = None) -> "Report":
        """Build a Report from a JSON layout spec (dict, or a path to a .json file).

        Relative dataset paths resolve against *base_dir* (default: the spec file's folder, or cwd).
        """
        if isinstance(spec, (str, os.PathLike)):
            spec_path = Path(spec)
            try:
                spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
            except json.JSONDecodeError as e:
                raise SpecError(f"{spec_path}: invalid JSON ({e})") from e
            except OSError as e:
                raise SpecError(f"cannot read spec {spec_path}: {e.strerror or e}") from e
            if base_dir is None:
                base_dir = spec_path.parent
        if not isinstance(spec, dict):
            raise SpecError("spec must be a JSON object")
        base = Path(base_dir) if base_dir is not None else Path.cwd()
        problems: list[str] = []

        def keys_ok(obj: Any, allowed: set[str], where: str) -> bool:
            if not isinstance(obj, dict):
                problems.append(f"{where}: expected an object, got {type(obj).__name__}")
                return False
            extra = sorted(set(obj) - allowed - {"$comment"})
            if extra:
                problems.append(f"{where}: unknown key(s) {', '.join(extra)} (allowed: {', '.join(sorted(allowed))})")
            return True

        keys_ok(spec, {"reportkit", "report", "params", "datasets", "topbar", "pages"}, "spec")
        rep = spec.get("report") or {}
        report_keys = {"title", "subtitle", "client", "date", "theme", "confidentiality", "locale", "firm"}
        keys_ok(rep, report_keys, "report")
        if not isinstance(rep, dict):
            rep = {}
        if not rep.get("title"):
            problems.append("report.title is required")
        r = cls(**{"title": "", **{k: v for k, v in rep.items() if k in report_keys}})

        for name, p in (spec.get("params") or {}).items():
            try:
                if isinstance(p, dict):
                    if keys_ok(p, {"value", "min", "max", "step", "format", "title"}, f"params.{name}"):
                        r.param(name, p.get("value"), **{k: p.get(k) for k in ("min", "max", "step", "format", "title")})
                else:
                    r.param(name, p)
            except (TypeError, ValueError) as e:
                problems.append(f"params.{name}: {e}")

        dsets = spec.get("datasets") or {}
        if isinstance(dsets, list):
            dsets = {d.get("id"): d for d in dsets if isinstance(d, dict)}
        ds_keys = {"path", "data", "rows", "id", "title", "fields", "schema", "source", "notes", "unit",
                   "as_of", "asOf", "computed", "meta"}
        for did, d in dsets.items():
            if not keys_ok(d, ds_keys, f"datasets.{did}"):
                continue
            fields = d.get("fields")
            if "path" in d:
                src: Any = Path(d["path"])
                if not src.is_absolute():
                    src = base / src
            elif "data" in d or "rows" in d:
                rows = d.get("data", d.get("rows"))
                if isinstance(rows, list):  # records / arrays, optionally contract-form
                    src = {"data": rows}
                    src.update({k: d[k] for k in ("schema", "meta", "computed", "title", "id") if k in d})
                    if isinstance(fields, list):
                        src["fields"], fields = fields, None
                else:
                    src = rows  # {column: [values]}
            else:
                problems.append(f"datasets.{did}: needs 'path' or 'data'")
                continue
            try:
                r.dataset(did, src, title=d.get("title"), fields=fields, source=d.get("source"),
                          notes=d.get("notes"), unit=d.get("unit"), as_of=d.get("as_of", d.get("asOf")),
                          computed=d.get("computed"))
            except (ReportKitError, OSError, TypeError, ValueError) as e:
                problems.append(f"datasets.{did}: {e}")

        block_keys = {"component", "data", "title", "subtitle", "span", "height", "options", "encode",
                      "source", "notes", "id"}
        for i, b in enumerate(spec.get("topbar") or []):
            if keys_ok(b, {"component", "data", "options", "encode", "id"}, f"topbar[{i}]"):
                if not b.get("component"):
                    problems.append(f"topbar[{i}]: 'component' is required")
                    continue
                try:
                    r.topbar_block(b["component"], options=b.get("options"), data=b.get("data"),
                                   encode=b.get("encode"), id=b.get("id"))
                except (ReportKitError, TypeError, ValueError) as e:
                    problems.append(f"topbar[{i}]: {e}")
        page_keys = {"title", "kicker", "subtitle", "source", "notes", "id", "kind", "nav", "num", "blocks"}
        for i, p in enumerate(spec.get("pages") or []):
            if not keys_ok(p, page_keys, f"pages[{i}]"):
                continue
            page = r.page(p.get("title") or "", kicker=p.get("kicker"), subtitle=p.get("subtitle"),
                          source=p.get("source"), notes=p.get("notes"), id=p.get("id"),
                          kind=p.get("kind") or "content", nav=p.get("nav"), num=p.get("num"))
            for j, b in enumerate(p.get("blocks") or []):
                if not keys_ok(b, block_keys, f"pages[{i}].blocks[{j}]"):
                    continue
                if not b.get("component"):
                    problems.append(f"pages[{i}].blocks[{j}]: 'component' is required")
                    continue
                try:
                    page.block(b["component"], data=b.get("data"), title=b.get("title"),
                               subtitle=b.get("subtitle"), span=b.get("span", 12), height=b.get("height"),
                               options=b.get("options"), encode=b.get("encode"), source=b.get("source"),
                               notes=b.get("notes"), id=b.get("id"))
                except (ReportKitError, TypeError, ValueError) as e:
                    problems.append(f"pages[{i}].blocks[{j}]: {e}")
        if problems:
            raise SpecError("Invalid report spec:\n  - " + "\n  - ".join(problems))
        return r

