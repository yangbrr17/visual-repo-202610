#!/usr/bin/env python3
"""Wrap offline geo data as classic scripts (file:// cannot fetch JSON).

    python3 tools/build_geo.py

vendor/world-atlas/countries-110m.json -> vendor/geo-world/world-110m.js       RK.geo.register('world-110m', <topojson>)
vendor/world-atlas/countries-50m.json  -> vendor/geo-world-50m/world-50m.js    RK.geo.register('world-50m', <topojson>)

Country feature ids are ISO 3166-1 numeric codes as zero-padded strings ("840", "036").
world-50m (1:50m Natural Earth, ~750 KB) is the higher-detail basemap; a report only ships it when a
map block asks for it (component manifest "optionDeps": {"basemap": {"world-50m": ["geo-world-50m"]}}).

Afterwards the sha256 of the generated files are recorded in vendor/vendor.json (tools/vendor.py --check).
"""
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTE = "world-atlas 2.0.2 {name} (ISC; Natural Earth data, public domain). ids = ISO 3166-1 numeric"

# (source json, package id / output folder, output file, basemap name)
TARGETS = [
    ("countries-110m.json", "geo-world", "world-110m.js", "world-110m"),
    ("countries-50m.json", "geo-world-50m", "world-50m.js", "world-50m"),
]


def wrap(src: Path, dest: Path, name: str, note: str) -> None:
    data = json.loads(src.read_text(encoding="utf-8"))
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        f"/* {note} */\n(function(){{var d={body};"
        f"if(window.RK&&RK.geo&&RK.geo.register)RK.geo.register('{name}',d);"
        f"else(window.__RK_GEO=window.__RK_GEO||{{}})['{name}']=d;}})();\n",
        encoding="utf-8", newline="\n",
    )
    print(f"wrote {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB)")


def main() -> None:
    wa = ROOT / "vendor" / "world-atlas"
    for src_name, pkg_id, out_name, basemap in TARGETS:
        out = ROOT / "vendor" / pkg_id
        wrap(wa / src_name, out / out_name, basemap, NOTE.format(name=src_name.rsplit(".", 1)[0]))
        shutil.copy2(wa / "LICENSE", out / "LICENSE")
    # record the generated files' sha256 in vendor/vendor.json
    sys.path.insert(0, str(ROOT / "tools"))
    import vendor  # tools/vendor.py

    manifest = vendor.load_manifest()
    ids = {pkg_id for _, pkg_id, _, _ in TARGETS}
    missing = ids - {p["id"] for p in manifest["packages"]}
    if missing:
        raise SystemExit(f"vendor/vendor.json has no entry for {', '.join(sorted(missing))}")
    vendor.rehash(manifest, ids)
    vendor.save_manifest(manifest)
    print(f"recorded sha256 for {', '.join(sorted(ids))} in vendor/vendor.json")


if __name__ == "__main__":
    main()
