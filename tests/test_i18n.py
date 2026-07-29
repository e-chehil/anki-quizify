import re
from pathlib import Path
import sys
import types
import unittest

from helpers import load_module


i18n = load_module("i18n")
PROJECT_ROOT = Path(__file__).resolve().parents[1]


def messages(value):
    if isinstance(value, dict):
        return tuple(str(item) for item in value.values())
    return (str(value),)


def placeholders(value):
    found = set()
    for message in messages(value):
        found.update(
            re.findall(r"(?<!\{)\{([A-Za-z0-9_]+)\}(?!\})", message)
        )
    return found


class I18nTest(unittest.TestCase):
    def test_normalizes_supported_anki_languages_and_falls_back_to_english(self):
        cases = {
            "en": "en",
            "en_US": "en",
            "en-GB": "en",
            "ru": "ru",
            "ru_RU": "ru",
            "zh": "zh-CN",
            "zh_CN": "zh-CN",
            "zh_TW": "zh-CN",
            "fr_FR": "en",
            "": "en",
            None: "en",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(i18n.normalize_locale(raw), expected)

    def test_translates_formats_and_falls_back_per_key(self):
        self.assertEqual(i18n.tr("common.cancel", locale="zh_CN"), "取消")
        self.assertEqual(i18n.tr("common.cancel", locale="ru_RU"), "Отмена")
        self.assertEqual(
            i18n.tr("startup.unsupported", locale="en", version="1.2.3").split()[2],
            "1.2.3",
        )
        self.assertEqual(i18n.tr("missing.key", locale="ru"), "missing.key")
        self.assertEqual(i18n.tr("common.cancel", locale="fr"), "Cancel")

    def test_current_locale_reads_anki_language_and_profile_fallback(self):
        saved = {name: sys.modules.get(name) for name in ("anki", "anki.lang", "aqt")}
        try:
            anki = types.ModuleType("anki")
            anki.__path__ = []
            anki_lang = types.ModuleType("anki.lang")
            anki_lang.current_lang = "ru_RU"
            anki.lang = anki_lang
            sys.modules["anki"] = anki
            sys.modules["anki.lang"] = anki_lang
            self.assertEqual(i18n.current_locale(), "ru")

            anki_lang.current_lang = ""
            aqt = types.ModuleType("aqt")
            aqt.mw = types.SimpleNamespace(
                pm=types.SimpleNamespace(meta={"defaultLang": "zh_TW"})
            )
            sys.modules["aqt"] = aqt
            self.assertEqual(i18n.current_locale(), "zh-CN")
        finally:
            for name, module in saved.items():
                if module is None:
                    sys.modules.pop(name, None)
                else:
                    sys.modules[name] = module

    def test_russian_plural_categories(self):
        expected = {
            0: "many",
            1: "one",
            2: "few",
            4: "few",
            5: "many",
            11: "many",
            21: "one",
            22: "few",
            25: "many",
            101: "one",
            111: "many",
        }
        for count, category in expected.items():
            with self.subTest(count=count):
                self.assertEqual(i18n.plural_category("ru", count), category)

    def test_catalogs_are_complete_and_placeholder_compatible(self):
        catalogs = i18n.available_catalogs()
        english_keys = set(catalogs["en"])
        self.assertGreater(len(english_keys), 250)
        for locale, catalog in catalogs.items():
            self.assertEqual(set(catalog), english_keys, locale)
            for key, value in catalog.items():
                self.assertTrue(all(message.strip() for message in messages(value)), (locale, key))
                self.assertEqual(
                    placeholders(value),
                    placeholders(catalogs["en"][key]),
                    (locale, key),
                )

    def test_non_chinese_catalogs_have_no_han_or_chinese_punctuation(self):
        catalogs = i18n.available_catalogs()
        forbidden = re.compile(r"[\u3400-\u9fff：；，。]")
        for locale in ("en", "ru"):
            for key, value in catalogs[locale].items():
                for message in messages(value):
                    self.assertIsNone(forbidden.search(message), (locale, key, message))

    def test_every_static_translation_reference_exists(self):
        referenced = set()
        pattern = re.compile(r"\b(?:tr|trn|t|tn)\(\s*['\"]([^'\"]+)['\"]")
        files = list((PROJECT_ROOT / "quizify_addon").rglob("*.py"))
        files.extend((PROJECT_ROOT / "src").rglob("*.js"))
        for path in files:
            referenced.update(pattern.findall(path.read_text(encoding="utf-8")))
        missing = referenced - set(i18n.available_catalogs()["en"])
        self.assertFalse(missing, sorted(missing))


if __name__ == "__main__":
    unittest.main()
