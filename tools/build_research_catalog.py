#!/usr/bin/env python3
"""Merge the structured research results (research/raw/*.json) into research/catalog.json.

    python3 tools/build_research_catalog.py

Deduplicates libraries by normalised name across research angles, keeps the most informative
entry, records every angle that evaluated it, and flags libraries vendored in this kit.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "research" / "raw"
VERDICT_RANK = {"adopt": 0, "consider": 1, "reference": 2, "avoid": 3}


def norm(name: str) -> str:
    n = name.lower()
    n = re.sub(r"\(.*?\)", "", n)
    n = re.sub(r"\b(js|v\d+(\.\d+)*|community|library)\b", "", n)
    return re.sub(r"[^a-z0-9一-鿿]+", "", n)


def main() -> None:
    vendor = json.loads((ROOT / "vendor" / "vendor.json").read_text(encoding="utf-8"))
    vendored = {p["npm"].lower(): p["id"] for p in vendor["packages"]}
    vendored_names = {norm(p["id"]) for p in vendor["packages"]} | {norm(p["npm"]) for p in vendor["packages"]}
    merged: dict[str, dict] = {}
    angles = []
    for f in sorted(RAW.glob("*.json")):
        r = json.loads(f.read_text(encoding="utf-8"))
        angles.append({"angle": r["angle"], "summary": r.get("summary", ""), "insights": r.get("key_insights", []),
                       "notes": f"research/raw/{r['angle']}.md", "count": len(r.get("libraries", []))})
        for lib in r.get("libraries", []):
            key = norm(lib.get("name", ""))
            if not key:
                continue
            lib = {k: v for k, v in lib.items() if v not in (None, "", [])}
            lib["angles"] = [r["angle"]]
            cur = merged.get(key)
            if cur is None:
                merged[key] = lib
                continue
            cur["angles"] = sorted(set(cur["angles"]) | {r["angle"]})
            # keep the more informative / more decisive record, fill gaps from the other
            if len(json.dumps(lib)) > len(json.dumps(cur)):
                lib["angles"] = cur["angles"]
                for k, v in cur.items():
                    lib.setdefault(k, v)
                merged[key] = lib
            else:
                for k, v in lib.items():
                    cur.setdefault(k, v)
    libs = list(merged.values())
    for lib in libs:
        npm = str(lib.get("npm", "")).lower()
        lib["in_kit"] = npm in vendored or norm(lib["name"]) in vendored_names
    libs.sort(key=lambda l: (str(l.get("category", "zz")), VERDICT_RANK.get(l.get("verdict"), 9), l["name"].lower()))
    counts = {}
    for l in libs:
        counts[l.get("verdict", "?")] = counts.get(l.get("verdict", "?"), 0) + 1
    out = {
        "generated": "2026-10-14",
        "summary_zh": (f"9 个调研方向、{len(libs)} 个开源项目（去重后）。结论：{counts.get('adopt', 0)} 个采用、"
                       f"{counts.get('consider', 0)} 个备选、{counts.get('reference', 0)} 个仅作参考、{counts.get('avoid', 0)} 个避免。"
                       "主引擎 Apache ECharts 6.1，地图 Leaflet 1.9.4（离线 Natural Earth 底图），交互表格 Tabulator 6.6，"
                       "版式表格与动效为自研（零依赖）。完整报告见 research/landscape.md。"),
        "angles": angles,
        "libraries": libs,
    }
    (ROOT / "research" / "catalog.json").write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"research/catalog.json: {len(libs)} libraries from {len(angles)} angles; verdicts {counts}")


if __name__ == "__main__":
    main()
