from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from .core import config_json_for_html


SCHEMA_VERSION = 1
DEFAULT_NOTE_TYPE = "Quizify Markdown"
DEVELOPER_CONTACT = "chehil@163.com"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def default_config(addon_dir: Path) -> dict:
    return read_json(addon_dir / "config.json")


def _bool(value, fallback: bool) -> bool:
    return value if isinstance(value, bool) else fallback


def normalize_config(defaults: dict, stored) -> dict:
    """Normalize v1 config and migrate the supported 0.6.x preferences."""
    stored = stored if isinstance(stored, dict) else {}
    review = stored.get("review") if isinstance(stored.get("review"), dict) else {}
    platform = (
        stored.get("platform") if isinstance(stored.get("platform"), dict) else {}
    )
    default_review = defaults["review"]
    default_platform = defaults["platform"]

    raw_name = stored.get("note_type", defaults["note_type"])
    note_type = raw_name.strip() if isinstance(raw_name, str) else ""

    return {
        "schema_version": SCHEMA_VERSION,
        "note_type": note_type or defaults["note_type"],
        "review": {
            "cardless": _bool(
                review.get("cardless", stored.get("cardless")),
                default_review["cardless"],
            ),
            "floating_control": _bool(
                review.get(
                    "floating_control", stored.get("enable_floating_ball")
                ),
                default_review["floating_control"],
            ),
        },
        "platform": {
            "ankidroid_api": _bool(
                platform.get(
                    "ankidroid_api", stored.get("enable_ankidroid_api")
                ),
                default_platform["ankidroid_api"],
            )
        },
    }


def get_config(mw, addon_dir: Path, module_name: str) -> dict:
    defaults = default_config(addon_dir)
    stored = mw.addonManager.getConfig(module_name) or {}
    return normalize_config(defaults, stored)


def migrate_config(mw, addon_dir: Path, module_name: str) -> dict:
    stored = mw.addonManager.getConfig(module_name) or {}
    normalized = normalize_config(default_config(addon_dir), stored)
    if stored != normalized:
        mw.addonManager.writeConfig(module_name, deepcopy(normalized))
    return normalized


def note_type_name(config: dict) -> str:
    value = config.get("note_type") if isinstance(config, dict) else None
    return value.strip() if isinstance(value, str) and value.strip() else DEFAULT_NOTE_TYPE


def config_script(config: dict) -> str:
    return (
        '<script type="application/json" id="quizify-config">'
        f"{config_json_for_html(config)}"
        "</script>"
    )


def apply_config_transaction(
    current: dict,
    proposed: dict,
    *,
    sync_media,
    ensure_notetype,
    write_config,
) -> dict:
    """Apply settings only after dependent work succeeds, with best-effort rollback.

    Media files are a repairable cache and are synchronized first.  The
    notetype may need to choose a collision-safe name, so its result is folded
    into the candidate before the config becomes visible.  If a later step
    fails, the previous notetype/config are restored without hiding the
    original exception.
    """
    previous = deepcopy(current)
    candidate = deepcopy(proposed)
    notetype_attempted = False
    config_attempted = False

    try:
        sync_media()
        notetype_attempted = True
        actual_name = ensure_notetype(deepcopy(candidate))
        if not isinstance(actual_name, str) or not actual_name.strip():
            raise RuntimeError("notetype update returned an invalid name")
        candidate["note_type"] = actual_name.strip()
        config_attempted = True
        write_config(deepcopy(candidate))
    except Exception:
        if notetype_attempted:
            try:
                ensure_notetype(deepcopy(previous))
            except Exception:
                pass
        if config_attempted:
            try:
                write_config(deepcopy(previous))
            except Exception:
                pass
        raise

    return candidate
