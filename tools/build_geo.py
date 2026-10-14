#!/usr/bin/env python3
"""Wrap offline geo data as classic scripts (file:// cannot fetch JSON).

    python3 tools/build_geo.py

vendor/world-atlas/countries-110m.json -> vendor/geo-world/world-110m.js
    RK.geo.register('world-110m', <topojson>)
Country feature ids are ISO 3166-1 numeric codes as zero-padded strings ("840", "036").
"""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def wrap(src: Path, dest: Path, name: str, note: str) -> None:
    data = json.loads(src.read_text(encoding="utf-8"))
    body = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(
        f"/* {note} */\n(function(){{var d={body};"
        f"if(window.RK&&RK.geo&&RK.geo.register)RK.geo.register('{name}',d);"
        f"else(window.__RK_GEO=window.__RK_GEO||{{}})['{name}']=d;}})();\n",
        encoding="utf-8",
    )
    print(f"wrote {dest.relative_to(ROOT)} ({dest.stat().st_size // 1024} KB)")


def main() -> None:
    wa = ROOT / "vendor" / "world-atlas"
    out = ROOT / "vendor" / "geo-world"
    wrap(wa / "countries-110m.json", out / "world-110m.js", "world-110m",
         "world-atlas 2.0.2 countries-110m (ISC; Natural Earth data, public domain). ids = ISO 3166-1 numeric")
    shutil.copy2(wa / "LICENSE", out / "LICENSE")


if __name__ == "__main__":
    main()
