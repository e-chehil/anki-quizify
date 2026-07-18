from pathlib import Path
import tempfile
import types
import unittest

from helpers import load_module


notetype = load_module("notetype")


class FakeModels:
    def __init__(self, models=()):
        self.models = {model["name"]: model for model in models}
        self.saved = []

    def by_name(self, name):
        return self.models.get(name)

    def new(self, name):
        return {"name": name, "flds": [], "tmpls": [], "css": ""}

    def add(self, model):
        for template in model.get("tmpls", []):
            if "{{" not in template.get("qfmt", ""):
                raise RuntimeError("Anki rejects a front template without a field")
        self.models[model["name"]] = model

    def new_field(self, name):
        return {"name": name, "plainText": False}

    def add_field(self, model, field):
        model.setdefault("flds", []).append(field)

    def new_template(self, name):
        return {"name": name, "qfmt": "", "afmt": ""}

    def add_template(self, model, template):
        model.setdefault("tmpls", []).append(template)

    def save(self, model):
        self.saved.append(model)

    def update_dict(self, model):
        self.saved.append(model)


def config(name="Quizify Markdown"):
    return {
        "schema_version": 1,
        "note_type": name,
        "review": {"cardless": False, "floating_control": True},
        "platform": {"ankidroid_api": True},
    }


class NoteTypeTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addon = Path(self.temporary.name)
        (self.addon / "templates").mkdir()
        (self.addon / "templates" / "front.html").write_text(
            '{{Front}}\n<script src="./_quizify.js"></script>', encoding="utf-8"
        )
        (self.addon / "templates" / "back.html").write_text(
            '{{Front}}\n{{Back}}\n<script>Quizify.boot({side:"back"})</script>',
            encoding="utf-8",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def test_updates_only_the_owned_template(self):
        custom = {"name": "Custom", "qfmt": "keep", "afmt": "keep"}
        managed = {
            "name": "Renamed Legacy Template",
            "qfmt": '<script id="quizify-config"></script>',
            "afmt": '<script src="./_quizify.js"></script>',
        }
        model = {
            "name": "Quizify Markdown",
            "flds": [
                {"name": "Front", "plainText": False},
                {"name": "Extra", "plainText": False},
            ],
            "tmpls": [custom, managed],
            "css": "old",
        }
        models = FakeModels([model])
        mw = types.SimpleNamespace(col=types.SimpleNamespace(models=models))

        actual = notetype.ensure_notetype(mw, self.addon, config())

        fields = {field["name"]: field for field in model["flds"]}
        self.assertEqual(actual, "Quizify Markdown")
        self.assertEqual(model["tmpls"][0], custom)
        self.assertIn(notetype.MANAGED_TEMPLATE_MARKER, managed["qfmt"])
        self.assertTrue(fields["Front"]["plainText"])
        self.assertTrue(fields["Back"]["plainText"])
        self.assertFalse(fields["Extra"]["plainText"])
        self.assertIn(notetype.MANAGED_CSS_START, model["css"])
        self.assertTrue(model["css"].endswith("old"))
        self.assertEqual(len(models.saved), 1)

        notetype.ensure_notetype(mw, self.addon, config())
        self.assertEqual(len(models.saved), 1, "an unchanged model must not be saved")

    def test_preserves_an_unowned_name_collision_and_creates_a_safe_model(self):
        existing = {
            "name": "Quizify Markdown",
            "flds": [{"name": "Question", "plainText": False}],
            "tmpls": [{"name": "Card 1", "qfmt": "original", "afmt": "original"}],
            "css": "original css",
        }
        models = FakeModels([existing])
        mw = types.SimpleNamespace(col=types.SimpleNamespace(models=models))

        actual = notetype.ensure_notetype(mw, self.addon, config())

        self.assertEqual(actual, "Quizify Markdown (Quizify)")
        self.assertEqual(existing["css"], "original css")
        self.assertEqual(existing["tmpls"][0]["qfmt"], "original")
        created = models.by_name(actual)
        self.assertIsNotNone(created)
        self.assertIn(notetype.MANAGED_TEMPLATE_MARKER, created["tmpls"][0]["qfmt"])
        self.assertEqual(created["tmpls"][0]["name"], "Quizify")

    def test_does_not_claim_a_template_from_its_name_or_one_legacy_marker(self):
        suspicious = {
            "name": "Quizify",
            "qfmt": '<script id="quizify-config"></script>',
            "afmt": "user-owned answer",
        }
        existing = {
            "name": "Quizify Markdown",
            "flds": [{"name": "Front", "plainText": False}],
            "tmpls": [suspicious],
            "css": "user css",
        }
        models = FakeModels([existing])
        mw = types.SimpleNamespace(col=types.SimpleNamespace(models=models))

        actual = notetype.ensure_notetype(mw, self.addon, config())

        self.assertEqual(actual, "Quizify Markdown (Quizify)")
        self.assertEqual(suspicious["qfmt"], '<script id="quizify-config"></script>')
        self.assertEqual(suspicious["afmt"], "user-owned answer")
        self.assertEqual(existing["css"], "user css")

    def test_managed_css_replacement_is_idempotent_and_preserves_user_css(self):
        original = (
            "/* user before */\n"
            f"{notetype.MANAGED_CSS_START}\nold managed data\n"
            f"{notetype.MANAGED_CSS_END}\n"
            ".card { color: rebeccapurple; }"
        )

        updated = notetype._css_with_managed_block(original)

        self.assertTrue(updated.startswith("/* user before */\n"))
        self.assertTrue(updated.endswith(".card { color: rebeccapurple; }"))
        self.assertEqual(updated.count(notetype.MANAGED_CSS_START), 1)
        self.assertEqual(notetype._css_with_managed_block(updated), updated)

    def test_uses_a_numbered_name_when_the_safe_fallback_also_exists(self):
        collisions = [
            {"name": "Quizify Markdown", "tmpls": [], "flds": []},
            {"name": "Quizify Markdown (Quizify)", "tmpls": [], "flds": []},
        ]
        models = FakeModels(collisions)
        mw = types.SimpleNamespace(col=types.SimpleNamespace(models=models))

        actual = notetype.ensure_notetype(mw, self.addon, config())

        self.assertEqual(actual, "Quizify Markdown (Quizify 2)")


if __name__ == "__main__":
    unittest.main()
