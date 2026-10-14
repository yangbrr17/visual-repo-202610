#!/usr/bin/env python3
"""Fetch pinned third-party front-end builds from npm into vendor/ and record their integrity.

Every package is declared in vendor/vendor.json (name, npm spec, license, upstream repo, and which
files of the published tarball we keep). Running this script is reproducible: same manifest -> same
files. For every package vendor.json also records

    "integrity": "sha512-..."            npm dist.integrity of the tarball (npm packages only)
    "sha256": {"<dst file>": "<hex>"}     sha256 of every file we ship (generated files for "local" ones)

so `--check` can prove that what ships in reports is exactly what was vendored.

    python3 tools/vendor.py              # fetch every npm package (npm pack --ignore-scripts), hash all
    python3 tools/vendor.py echarts      # fetch one id (and refresh its hashes)
    python3 tools/vendor.py --rehash     # no network: re-record hashes of the files on disk
    python3 tools/vendor.py --check      # no network: every file present and matching its sha256

A recorded "integrity" pins the tarball: a later fetch of the same id whose integrity differs is an
error (delete the "integrity" key after deliberately changing "version").
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor"
MANIFEST = VENDOR / "vendor.json"


def load_manifest(root: Path = ROOT) -> dict:
    return json.loads((root / "vendor" / "vendor.json").read_text(encoding="utf-8"))


def save_manifest(manifest: dict, root: Path = ROOT) -> None:
    text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
    (root / "vendor" / "vendor.json").write_text(text, encoding="utf-8", newline="\n")


def pkg_dest(pkg: dict, root: Path = ROOT) -> Path:
    return root / pkg["dest"] if pkg.get("dest") else root / "vendor" / pkg["id"]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def shipped_files(pkg: dict, root: Path = ROOT) -> list[str]:
    """Destination paths (relative to the package folder, '/'-separated) of every file the package ships.
    A directory mapping ("dist/images/": "images/") expands to the files inside it."""
    base = pkg_dest(pkg, root)
    out: list[str] = []
    for dst_rel in pkg["files"].values():
        target = base / dst_rel.rstrip("/")
        if dst_rel.endswith("/") or target.is_dir():
            if target.is_dir():
                for f in sorted(target.rglob("*")):
                    if f.is_file() and not any(p.startswith(".") for p in f.relative_to(base).parts):
                        out.append(f.relative_to(base).as_posix())
        else:
            out.append(dst_rel)
    return sorted(dict.fromkeys(out))


def hash_package(pkg: dict, root: Path = ROOT) -> dict[str, str]:
    base = pkg_dest(pkg, root)
    return {rel: sha256_file(base / rel) for rel in shipped_files(pkg, root) if (base / rel).is_file()}


def _set_hashes(pkg: dict, hashes: dict[str, str], integrity: str | None = None) -> None:
    """Keep key order stable: ... files, integrity, sha256."""
    pkg.pop("sha256", None)
    if integrity:
        pkg.pop("integrity", None)
        pkg["integrity"] = integrity
    elif "integrity" in pkg:
        pkg["integrity"] = pkg.pop("integrity")
    pkg["sha256"] = dict(sorted(hashes.items()))


def _sri_sha512(path: Path) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode("ascii")


def npm_pack(spec: str, work: Path) -> tuple[Path, str]:
    """npm pack <spec> (lifecycle scripts disabled) -> (tarball path, dist.integrity)."""
    proc = subprocess.run(
        ["npm", "pack", spec, "--json", "--ignore-scripts", "--pack-destination", str(work)],
        check=True, capture_output=True, text=True,
    )
    info = json.loads(proc.stdout)
    info = info[0] if isinstance(info, list) else info
    tgz = work / info["filename"].replace("/", "-").lstrip("@")
    if not tgz.is_file():  # scoped names: npm writes "scope-name-1.0.0.tgz"
        cands = sorted(work.glob("*.tgz"), key=lambda p: p.stat().st_mtime)
        tgz = cands[-1]
    integrity = info.get("integrity") or ""
    actual = _sri_sha512(tgz)
    if integrity and integrity != actual:
        raise SystemExit(f"[{spec}] tarball sha512 {actual} does not match npm dist.integrity {integrity}")
    return tgz, integrity or actual


def _sync(staging: Path, dest: Path) -> None:
    """Make *dest* identical to *staging*, touching only files whose bytes changed."""
    dest.mkdir(parents=True, exist_ok=True)
    want = {p.relative_to(staging) for p in staging.rglob("*") if p.is_file()}
    for rel in sorted(want):
        src, dst = staging / rel, dest / rel
        if dst.is_file() and dst.read_bytes() == src.read_bytes():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    for p in sorted(dest.rglob("*"), reverse=True):
        rel = p.relative_to(dest)
        if p.is_file() and rel not in want and not rel.name.startswith("."):
            p.unlink()
        elif p.is_dir() and not any(p.iterdir()):
            p.rmdir()


def fetch(pkg: dict, work: Path, root: Path = ROOT) -> None:
    spec = f"{pkg['npm']}@{pkg['version']}"
    tgz, integrity = npm_pack(spec, work)
    pinned = pkg.get("integrity")
    if pinned and pinned != integrity:
        raise SystemExit(f"[{pkg['id']}] {spec}: npm integrity {integrity} differs from the pinned {pinned}. "
                         "If you changed 'version' on purpose, delete the 'integrity' key and re-run.")
    extract = work / f"x-{pkg['id']}"
    extract.mkdir()
    with tarfile.open(tgz) as tf:
        tf.extractall(extract, filter="data")
    src_root = extract / "package"
    staging = work / f"s-{pkg['id']}"
    staging.mkdir()
    for src_rel, dst_rel in pkg["files"].items():
        matches = sorted(src_root.glob(src_rel)) if any(c in src_rel for c in "*?[") else [src_root / src_rel]
        if not matches or not matches[0].exists():
            raise SystemExit(f"[{pkg['id']}] missing file in tarball: {src_rel}")
        for m in matches:
            if m.is_dir():
                target = staging / dst_rel.rstrip("/")
            elif dst_rel.endswith("/"):
                target = staging / dst_rel / m.name
            else:
                target = staging / dst_rel
            target.parent.mkdir(parents=True, exist_ok=True)
            if m.is_dir():
                shutil.copytree(m, target, dirs_exist_ok=True)
            else:
                shutil.copy2(m, target)
    _sync(staging, pkg_dest(pkg, root))
    _set_hashes(pkg, hash_package(pkg, root), integrity)
    print(f"  ok  {pkg['id']:<22} {spec}  {integrity[:23]}…")


def write_licenses(manifest: dict, root: Path = ROOT) -> None:
    lines = [
        "# Third-party components",
        "",
        "Generated by `tools/vendor.py` from `vendor/vendor.json`. Each folder keeps the",
        "upstream LICENSE/NOTICE file next to the distributed build. `python3 tools/vendor.py --check`",
        "verifies every shipped file against the sha256 recorded in `vendor/vendor.json`.",
        "",
        "| id | package | version | license | upstream | used for |",
        "|---|---|---|---|---|---|",
    ]
    for p in manifest["packages"]:
        lines.append(
            f"| `{p['id']}` | `{p['npm']}` | {p['version']} | {p['license']} | {p['repo']} | {p.get('purpose', '')} |"
        )
    (root / "vendor" / "LICENSES.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def check(manifest: dict, root: Path = ROOT, quiet: bool = False) -> int:
    """Every declared file exists and matches its recorded sha256; nothing unrecorded ships."""
    problems: list[str] = []
    for p in manifest["packages"]:
        base = pkg_dest(p, root)
        try:
            shown = base.relative_to(root).as_posix()
        except ValueError:
            shown = str(base)
        for dst_rel in p["files"].values():
            if not (base / dst_rel.rstrip("/")).exists():
                problems.append(f"missing: {shown}/{dst_rel}")
        recorded = p.get("sha256")
        if not isinstance(recorded, dict) or not recorded:
            problems.append(f"no sha256 recorded for '{p['id']}' — run: python3 tools/vendor.py --rehash {p['id']}")
            continue
        for rel, want in sorted(recorded.items()):
            f = base / rel
            if not f.is_file():
                problems.append(f"missing: {shown}/{rel}")
            elif sha256_file(f) != want:
                problems.append(f"sha256 mismatch: {shown}/{rel} (file changed since it was vendored)")
        for rel in shipped_files(p, root):
            if rel not in recorded:
                problems.append(f"unrecorded file: {shown}/{rel} (not in vendor.json sha256)")
        if base.is_dir() and not p.get("dest"):
            # the whole vendor/<id>/ folder is copied into reports: nothing unrecorded may sit there
            for f in sorted(base.rglob("*")):
                rel = f.relative_to(base).as_posix()
                if f.is_file() and not any(x.startswith(".") for x in f.relative_to(base).parts) and rel not in recorded:
                    problems.append(f"unexpected file: {shown}/{rel} (would ship in reports; not in vendor.json)")
    problems = list(dict.fromkeys(problems))
    if not quiet:
        for msg in problems:
            print(msg)
        n = sum(len(p.get("sha256") or {}) for p in manifest["packages"])
        print("vendor check:", f"OK ({len(manifest['packages'])} packages, {n} files verified)" if not problems
              else f"{len(problems)} problem(s)")
    return 1 if problems else 0


def rehash(manifest: dict, ids: set[str] | None = None, root: Path = ROOT) -> None:
    for p in manifest["packages"]:
        if ids and p["id"] not in ids:
            continue
        _set_hashes(p, hash_package(p, root))


def main(argv: list[str]) -> int:
    manifest = load_manifest()
    if "--check" in argv:
        return check(manifest)
    only = {a for a in argv if not a.startswith("-")}
    unknown = only - {p["id"] for p in manifest["packages"]}
    if unknown:
        raise SystemExit(f"unknown vendor id(s): {', '.join(sorted(unknown))}")
    if "--rehash" in argv:
        rehash(manifest, only or None)
    else:
        env_ok = shutil.which("npm") is not None
        if not env_ok:
            raise SystemExit("npm is required to fetch packages (use --rehash / --check offline)")
        with tempfile.TemporaryDirectory() as tmp:
            for pkg in manifest["packages"]:
                if only and pkg["id"] not in only:
                    continue
                if pkg.get("local"):
                    # generated in-repo (tools/build_geo.py): hash the generated files
                    _set_hashes(pkg, hash_package(pkg))
                    print(f"  ok  {pkg['id']:<22} (local, {len(pkg['sha256'])} files hashed)")
                    continue
                work = Path(tmp) / pkg["id"]
                work.mkdir()
                fetch(pkg, work)
    save_manifest(manifest)
    write_licenses(manifest)
    return check(manifest)


if __name__ == "__main__":
    os.environ.setdefault("npm_config_ignore_scripts", "true")
    sys.exit(main(sys.argv[1:]))
