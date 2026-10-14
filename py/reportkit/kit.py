"""Locate and read the front-end kit: kit/build.json, component manifests, vendor/vendor.json."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .errors import KitNotFoundError

__all__ = ["Kit", "CATEGORIES", "THEME_LABELS", "COMPONENT_ID_RE"]

CATEGORIES = ("layout", "controls", "valuation", "trend", "comparison", "composition", "bridge",
              "distribution", "flow", "geo", "table", "timeline")

# Fallback labels for the theme <select> (build.json may override with "themeLabels").
THEME_LABELS = {"navy": "Navy classic", "bronze": "Bronze & ivory", "slate": "Slate modern", "ink": "Ink (dark)"}

COMPONENT_ID_RE = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")

# Vendor packages that are plugins of another vendor package (loaded after it).
IMPLICIT_VENDOR_REQUIRES = {"leaflet-markercluster": ["leaflet"], "leaflet-heat": ["leaflet"]}


def _lookup(options: dict, name: str) -> tuple[bool, Any]:
    cur: Any = options
    for part in name.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False, None
        cur = cur[part]
    return True, cur


def _option_key(v: Any) -> str:
    """How an option value is spelled as an optionDeps key."""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else str(v)


def _read_json(path: Path) -> Any:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class Kit:
    """A kit root: the folder that contains ``kit/build.json`` (and usually ``vendor/``).

    >>> kit = Kit.locate()          # $REPORTKIT_HOME, else walk up from this package
    >>> kit.component("bar")        # manifest dict or None
    """

    def __init__(self, root: str | os.PathLike):
        root = Path(root).resolve()
        if (root / "build.json").is_file() and not (root / "kit" / "build.json").is_file():
            root = root.parent  # pointed at kit/ itself
        if not (root / "kit" / "build.json").is_file():
            raise KitNotFoundError(f"{root} does not contain kit/build.json")
        self.root = root
        self.kit_dir = root / "kit"
        self.vendor_dir = root / "vendor"
        self._build: dict | None = None
        self._vendor: list[dict] | None = None
        self._manifests: dict[str, dict | None] = {}

    def __repr__(self) -> str:
        return f"Kit({str(self.root)!r})"

    # ------------------------------------------------------------------ discovery
    @classmethod
    def locate(cls, start: str | os.PathLike | None = None) -> "Kit":
        """$REPORTKIT_HOME, else *start* / this file's folders walking upwards."""
        env = os.environ.get("REPORTKIT_HOME")
        if env:
            try:
                return cls(env)
            except KitNotFoundError as e:
                raise KitNotFoundError(f"REPORTKIT_HOME={env!r}: {e}") from None
        here = Path(start).resolve() if start else Path(__file__).resolve().parent
        for d in (here, *here.parents):
            if (d / "kit" / "build.json").is_file():
                return cls(d)
        raise KitNotFoundError(
            "Could not find the ReportKit kit (a folder containing kit/build.json). "
            "Set REPORTKIT_HOME to the repository root, or pass kit=... to build().")

    # ------------------------------------------------------------------ build.json
    @property
    def build(self) -> dict:
        if self._build is None:
            self._build = _read_json(self.kit_dir / "build.json")
        return self._build

    @property
    def core_files(self) -> list[str]:
        return list(self.build.get("core", []))

    @property
    def style_files(self) -> list[str]:
        return list(self.build.get("styles", []))

    @property
    def themes(self) -> list[str]:
        return list(self.build.get("themes", [])) or [self.default_theme]

    @property
    def default_theme(self) -> str:
        return self.build.get("defaultTheme") or (self.build.get("themes") or ["navy"])[0]

    def theme_label(self, theme: str) -> str:
        labels = self.build.get("themeLabels") or {}
        return labels.get(theme) or THEME_LABELS.get(theme) or theme.replace("-", " ").capitalize()

    @property
    def version(self) -> str:
        v = self.build.get("version")
        if v:
            return str(v)
        core = self.kit_dir / "core" / "rk.core.js"
        if core.is_file():
            m = re.search(r"RK\.version\s*=\s*['\"]([^'\"]+)['\"]", core.read_text(encoding="utf-8"))
            if m:
                return m.group(1)
        from . import __version__
        return __version__

    @property
    def fonts_dir(self) -> Path:
        return self.kit_dir / "fonts"

    # ------------------------------------------------------------------ components
    def component_dir(self, cid: str) -> Path:
        return self.kit_dir / "components" / cid

    def component(self, cid: str) -> dict | None:
        """Manifest dict for component *cid*, or None if it does not exist."""
        if cid not in self._manifests:
            path = self.component_dir(cid) / "manifest.json" if COMPONENT_ID_RE.fullmatch(cid or "") else None
            self._manifests[cid] = _read_json(path) if path and path.is_file() else None
        return self._manifests[cid]

    def component_ids(self) -> list[str]:
        base = self.kit_dir / "components"
        if not base.is_dir():
            return []
        return sorted(d.name for d in base.iterdir() if (d / "manifest.json").is_file())

    def components(self) -> list[dict]:
        return [m for m in (self.component(c) for c in self.component_ids()) if m]

    def component_js(self, cid: str) -> Path:
        return self.component_dir(cid) / f"{cid}.js"

    def component_css(self, cid: str) -> Path | None:
        p = self.component_dir(cid) / f"{cid}.css"
        return p if p.is_file() else None

    @staticmethod
    def option_deps(manifest: dict, options: dict | None) -> list[str]:
        """Vendor ids a block needs because of its options (manifest ``optionDeps``, contract I6)::

            "optionDeps": {"basemap": {"world-50m": ["geo-world-50m"]}}

        An option not set on the block falls back to the manifest's ``options.<name>.default``. Dotted
        names ("map.basemap") address nested options; list-valued options match any element; booleans /
        numbers match their JSON spelling ("true", "2")."""
        table = manifest.get("optionDeps") or {}
        if not isinstance(table, dict):
            return []
        options = options if isinstance(options, dict) else {}
        out: list[str] = []
        for name, by_value in table.items():
            if not isinstance(by_value, dict):
                continue
            found, value = _lookup(options, name)
            if not found:
                spec = (manifest.get("options") or {}).get(name)
                value = spec.get("default") if isinstance(spec, dict) else None
            for v in value if isinstance(value, (list, tuple)) else [value]:
                ids = by_value.get(_option_key(v))
                for vid in ids if isinstance(ids, list) else []:
                    if isinstance(vid, str) and vid not in out:
                        out.append(vid)
        return out

    @staticmethod
    def option_dep_ids(manifest: dict) -> list[str]:
        """Every vendor id named anywhere in the manifest's optionDeps (for kit consistency checks)."""
        out: list[str] = []
        table = manifest.get("optionDeps") or {}
        for by_value in table.values() if isinstance(table, dict) else []:
            for ids in by_value.values() if isinstance(by_value, dict) else []:
                for vid in ids if isinstance(ids, list) else []:
                    if isinstance(vid, str) and vid not in out:
                        out.append(vid)
        return out

    @staticmethod
    def needs_data(manifest: dict) -> bool:
        for key in ("needs_data", "needsData"):
            if key in manifest:
                return manifest[key] is not False
        return True

    # ------------------------------------------------------------------ vendor
    @property
    def vendor_packages(self) -> list[dict]:
        if self._vendor is None:
            path = self.vendor_dir / "vendor.json"
            self._vendor = list(_read_json(path).get("packages", [])) if path.is_file() else []
        return self._vendor

    def vendor_package(self, vid: str) -> dict | None:
        return next((p for p in self.vendor_packages if p.get("id") == vid), None)

    def resolve_vendor(self, ids: list[str]) -> list[dict]:
        """Union of vendor ids (+ their requirements) as package dicts, in vendor.json order."""
        wanted: set[str] = set()
        stack = list(ids)
        while stack:
            vid = stack.pop()
            if vid in wanted:
                continue
            wanted.add(vid)
            pkg = self.vendor_package(vid) or {}
            stack.extend(pkg.get("requires") or IMPLICIT_VENDOR_REQUIRES.get(vid, []))
        return [p for p in self.vendor_packages if p.get("id") in wanted]

    @staticmethod
    def vendor_files(pkg: dict, ext: str) -> list[str]:
        """Destination file names of *pkg* ending in *ext* ('.js' / '.css'), in vendor.json order."""
        files = pkg.get("files") or {}
        dests = files.values() if isinstance(files, dict) else files
        return [d for d in dests if isinstance(d, str) and d.lower().endswith(ext)]
