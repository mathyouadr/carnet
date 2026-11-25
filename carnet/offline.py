"""Offline mode (CARNET_OFFLINE=1): the service worker served at <base>/sw.js.

The worker is rendered from sw.js with the list of the current build's files, so a new build gives a new
worker version: browsers install it, cache the new files and drop the old ones (no stale chunks)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).parent
TEMPLATE = HERE / "sw.js"
LIB = HERE / "sw-lib.js"


def manifest(static: Path, version: str) -> tuple[str, list[str]]:
    """(version tag, asset paths relative to the app base) of the built web app."""
    root = static / "assets"
    files = sorted(f"assets/{p.relative_to(root).as_posix()}" for p in root.rglob("*") if p.is_file()) if root.is_dir() else []
    h = hashlib.sha256(version.encode())
    for f in files:
        h.update(b"\0" + f.encode())
    return h.hexdigest()[:12], files


def render_sw(static: Path, version: str, base: str) -> str:
    tag, files = manifest(static, version)
    code = TEMPLATE.read_text(encoding="utf-8")
    tag = hashlib.sha256((tag + code + LIB.read_text(encoding="utf-8")).encode()).hexdigest()[:12]
    return (code.replace("{{BASE}}", json.dumps(base))
                .replace("{{VERSION}}", json.dumps(tag))
                .replace("{{ASSETS}}", json.dumps(files)))
