"""Small, dependency-free localization layer shared by Quizify's Python UI.

The add-on follows Anki's interface language.  Only the locales shipped by
Quizify are accepted; every other locale deliberately resolves to English.
"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
from typing import Mapping


DEFAULT_LOCALE = "en"
SUPPORTED_LOCALES = ("en", "zh-CN", "ru")
LOCALES_DIR = Path(__file__).with_name("locales")


def normalize_locale(value) -> str:
    """Map an Anki/BCP-47 locale to a shipped locale, falling back to English."""

    raw = str(value or "").strip().replace("_", "-")
    raw = raw.split(".", 1)[0].split("@", 1)[0].lower()
    if raw == "ru" or raw.startswith("ru-"):
        return "ru"
    if raw == "zh" or raw.startswith("zh-"):
        return "zh-CN"
    if raw == "en" or raw.startswith("en-"):
        return "en"
    return DEFAULT_LOCALE


def _anki_language():
    try:
        import anki.lang as anki_lang

        value = getattr(anki_lang, "current_lang", "")
        value = value() if callable(value) else value
        if value:
            return value
    except (ImportError, AttributeError, TypeError):
        pass

    try:
        from aqt import mw

        meta = getattr(getattr(mw, "pm", None), "meta", None)
        if isinstance(meta, Mapping):
            return meta.get("defaultLang", "")
    except (ImportError, AttributeError, TypeError):
        pass
    return ""


def current_locale() -> str:
    return normalize_locale(_anki_language())


@lru_cache(maxsize=len(SUPPORTED_LOCALES))
def _catalog(locale: str) -> dict:
    normalized = normalize_locale(locale)
    path = LOCALES_DIR / f"{normalized}.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        if normalized != DEFAULT_LOCALE:
            return _catalog(DEFAULT_LOCALE)
        return {}
    return value if isinstance(value, dict) else {}


class _SafeValues(dict):
    def __missing__(self, key):
        return "{" + str(key) + "}"


def _format(message, values: dict) -> str:
    text = str(message)
    if not values:
        return text
    try:
        return text.format_map(_SafeValues(values))
    except (ValueError, TypeError):
        return text


def _message(message_id: str, locale: str):
    normalized = normalize_locale(locale)
    value = _catalog(normalized).get(message_id)
    if value is None and normalized != DEFAULT_LOCALE:
        value = _catalog(DEFAULT_LOCALE).get(message_id)
    return message_id if value is None else value


def tr(message_id: str, /, *, locale: str | None = None, **values) -> str:
    message = _message(message_id, locale or current_locale())
    if isinstance(message, dict):
        message = message.get("other") or next(iter(message.values()), message_id)
    return _format(message, values)


def plural_category(locale: str, count: int | float) -> str:
    normalized = normalize_locale(locale)
    number = abs(int(count))
    if normalized == "ru":
        mod10 = number % 10
        mod100 = number % 100
        if mod10 == 1 and mod100 != 11:
            return "one"
        if 2 <= mod10 <= 4 and not 12 <= mod100 <= 14:
            return "few"
        return "many"
    if normalized == "en" and number == 1:
        return "one"
    return "other"


def trn(
    message_id: str,
    count: int | float,
    /,
    *,
    locale: str | None = None,
    **values,
) -> str:
    normalized = normalize_locale(locale or current_locale())
    message = _message(message_id, normalized)
    if isinstance(message, dict):
        category = plural_category(normalized, count)
        message = message.get(category) or message.get("other") or next(
            iter(message.values()), message_id
        )
    values = {"count": count, **values}
    return _format(message, values)


def available_catalogs() -> dict[str, dict]:
    """Return copies for validation/tests without exposing cached dictionaries."""

    return {locale: dict(_catalog(locale)) for locale in SUPPORTED_LOCALES}
