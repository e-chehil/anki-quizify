from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .core import files_identical


MANIFEST_NAME = "media-manifest.json"


def load_media_manifest(addon_dir: Path) -> dict:
    path = addon_dir / MANIFEST_NAME
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema_version") != 1 or not isinstance(data.get("files"), dict):
        raise ValueError("Unsupported Quizify media manifest")
    return data


def verify_media_file(path: Path, expected: dict) -> None:
    data = path.read_bytes()
    if len(data) != expected.get("bytes"):
        raise ValueError(f"Quizify media size mismatch: {path.name}")
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected.get("sha256"):
        raise ValueError(f"Quizify media checksum mismatch: {path.name}")


def media_status(addon_dir: Path) -> tuple[int, int, list[str]]:
    manifest = load_media_manifest(addon_dir)
    missing = []
    ready = 0
    for name, expected in manifest["files"].items():
        path = addon_dir / name
        try:
            verify_media_file(path, expected)
            ready += 1
        except (OSError, ValueError):
            missing.append(name)
    return ready, len(manifest["files"]), missing


def sync_media(mw, addon_dir: Path) -> list[str]:
    manifest = load_media_manifest(addon_dir)
    media_dir = Path(mw.col.media.dir())
    changed = []
    for name, expected in manifest["files"].items():
        source = addon_dir / name
        verify_media_file(source, expected)
        if not files_identical(source, media_dir / name):
            changed.append(source)

    existing = [source.name for source in changed if (media_dir / source.name).is_file()]
    if existing:
        mw.col.media.trash_files(existing)
    for source in changed:
        mw.col.media.add_file(str(source))
    return [source.name for source in changed]
