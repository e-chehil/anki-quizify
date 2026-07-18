"""Reject obsolete test names that unittest discovery would silently skip."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
obsolete = sorted((ROOT / "tests").glob("*.test.py"))
if obsolete:
    names = ", ".join(path.name for path in obsolete)
    raise SystemExit(f"Rename or remove undiscoverable Python tests: {names}")
