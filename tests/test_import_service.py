from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from helpers import load_module


service = load_module("importer.service")


NOTETYPE = {
    "id": 42,
    "name": "Quizify Markdown",
    "flds": [{"name": "Front"}, {"name": "Back"}],
}


class FakeNote(dict):
    def __init__(self):
        super().__init__()
        self.tags = []


class FakeModels:
    def by_name(self, name):
        return NOTETYPE if name == NOTETYPE["name"] else None


class FakeDecks:
    def __init__(self, filtered=()):
        self.created = []
        self.filtered = set(filtered)

    def by_name(self, name):
        if name in self.filtered:
            return {"name": name, "dyn": 1}
        return None

    def add_normal_deck_with_name(self, name):
        self.created.append(name)
        return SimpleNamespace(id=100 + len(self.created))


class FakeMedia:
    def __init__(self):
        self.added = []

    def add_file(self, path):
        self.added.append(path)
        return f"anki-{Path(path).name}"


class FakeDB:
    def __init__(self, note_ids):
        self.note_ids = list(note_ids)

    def list(self, query, model_id):
        assert "where mid = ?" in query
        assert model_id == NOTETYPE["id"]
        return list(self.note_ids)


class FakeCollection:
    def __init__(self, existing=(), *, fail_add=False, filtered=()):
        self.models = FakeModels()
        self.decks = FakeDecks(filtered)
        self.media = FakeMedia()
        self.existing = {
            index + 1: FakeNote() for index, _ in enumerate(existing)
        }
        for note, (front, back) in zip(self.existing.values(), existing):
            note["Front"] = front
            note["Back"] = back
        self.db = FakeDB(self.existing)
        self.fail_add = fail_add
        self.requests = []
        self.undo_entries = []
        self.merged = []
        self.undo_calls = 0

    def get_note(self, note_id):
        return self.existing[note_id]

    def new_note(self, notetype):
        assert notetype is NOTETYPE
        return FakeNote()

    def add_custom_undo_entry(self, label):
        self.undo_entries.append(label)
        return 7

    def add_notes(self, requests):
        self.requests = list(requests)
        if self.fail_add:
            raise RuntimeError("database failure")
        return SimpleNamespace()

    def merge_undo_entries(self, target):
        self.merged.append(target)
        return SimpleNamespace(merged=target)

    def undo(self):
        self.undo_calls += 1


def card(path, front="Front", back="Back", **overrides):
    values = {
        "source_path": path,
        "source_line": 1,
        "front_line": 2,
        "back_line": 4,
        "front": front,
        "back": back,
        "deck": "学习::测试",
        "tags": ("document",),
    }
    values.update(overrides)
    return service.ImportCard(**values)


def request(note, deck_id):
    return SimpleNamespace(note=note, deck_id=deck_id)


class ImportServiceTest(unittest.TestCase):
    def test_bulk_import_creates_decks_tags_and_exportable_media_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "daily.md"
            (root / "image.png").write_bytes(b"png")
            (root / "voice.mp3").write_bytes(b"mp3")
            col = FakeCollection()

            outcome = service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[
                    card(
                        source,
                        "See ![diagram](image.png)",
                        "Hear !audio[word](voice.mp3)",
                        tags=("card", "document"),
                    )
                ],
                fallback_deck="Fallback",
                extra_tags=("batch", "card"),
                request_factory=request,
            )

        self.assertEqual(outcome.created, 1)
        self.assertEqual(col.decks.created, ["学习::测试"])
        self.assertEqual(len(col.requests), 1)
        added = col.requests[0]
        self.assertEqual(added.deck_id, 101)
        self.assertEqual(added.note.tags, ["card", "document", "batch"])
        self.assertIn("![diagram](anki-image.png)", added.note["Front"])
        self.assertIn('<img src="anki-image.png">', added.note["Front"])
        self.assertIn("!audio[word](anki-voice.mp3)", added.note["Back"])
        self.assertIn('<audio src="anki-voice.mp3"></audio>', added.note["Back"])
        self.assertEqual(
            outcome.copied_media, ("anki-image.png", "anki-voice.mp3")
        )
        self.assertEqual(col.merged, [7])

    def test_skip_mode_uses_exact_normalized_front_and_back(self):
        col = FakeCollection(existing=[("Same\nFront", "Same & Back")])

        outcome = service.import_cards(
            col,
            notetype_name=NOTETYPE["name"],
            cards=[card(Path("daily.md"), "Same<br>Front", "Same &amp; Back")],
            fallback_deck="Fallback",
            duplicate_mode="skip",
            request_factory=request,
        )

        self.assertEqual(outcome.created, 0)
        self.assertEqual(outcome.skipped, 1)
        self.assertFalse(col.requests)
        self.assertFalse(col.undo_entries)

    def test_generated_media_manifest_does_not_change_duplicate_identity(self):
        existing_front = "See ![x](anki-image.png)"
        col = FakeCollection(existing=[(existing_front, "Back")])
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "daily.md"
            (source.parent / "image.png").write_bytes(b"image")

            outcome = service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(source, "See ![x](image.png)", "Back")],
                fallback_deck="Fallback",
                duplicate_mode="skip",
                request_factory=request,
            )

        self.assertEqual(outcome.skipped, 1)
        self.assertFalse(col.requests)

    def test_common_media_duplicate_is_skipped_before_media_manager_write(self):
        col = FakeCollection(existing=[("See ![x](image.png)", "Back")])
        col.media.add_file = lambda _path: self.fail(
            "duplicate media must not be copied"
        )
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "daily.md"
            (source.parent / "image.png").write_bytes(b"image")

            outcome = service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(source, "See ![x](image.png)", "Back")],
                fallback_deck="Fallback",
                duplicate_mode="skip",
                request_factory=request,
            )

        self.assertEqual(outcome.skipped, 1)
        self.assertFalse(col.requests)

    def test_html_editor_breaks_inside_manifest_do_not_change_identity(self):
        stored = (
            "Front<br><br>&lt;!-- quizify-media:v1<br>"
            "&lt;img src=&quot;image.png&quot;&gt;<br>--&gt;"
        )

        self.assertEqual(service._normalize_field(stored), "Front")

    def test_direct_service_calls_reject_tags_containing_whitespace(self):
        col = FakeCollection()

        with self.assertRaises(service.ImportValidationError):
            service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(Path("daily.md"), tags=("two words",))],
                fallback_deck="Fallback",
                request_factory=request,
            )
        with self.assertRaisesRegex(ValueError, "Additional tags"):
            service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(Path("daily.md"))],
                fallback_deck="Fallback",
                extra_tags=("two words",),
                request_factory=request,
            )

    def test_create_mode_keeps_exact_duplicates(self):
        col = FakeCollection(existing=[("Front", "Back")])

        outcome = service.import_cards(
            col,
            notetype_name=NOTETYPE["name"],
            cards=[card(Path("daily.md"))],
            fallback_deck="Fallback",
            duplicate_mode="create",
            request_factory=request,
        )

        self.assertEqual(outcome.created, 1)
        self.assertEqual(len(col.requests), 1)

    def test_drafts_are_counted_without_collection_changes(self):
        col = FakeCollection()

        outcome = service.import_cards(
            col,
            notetype_name=NOTETYPE["name"],
            cards=[card(Path("daily.md"), draft=True)],
            fallback_deck="Fallback",
            request_factory=request,
        )

        self.assertEqual(outcome.drafts, 1)
        self.assertEqual(outcome.created, 0)
        self.assertFalse(col.undo_entries)

    def test_preflight_missing_media_leaves_collection_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "daily.md"
            col = FakeCollection()
            with self.assertRaises(service.ImportValidationError) as raised:
                service.import_cards(
                    col,
                    notetype_name=NOTETYPE["name"],
                    cards=[card(source, "![x](missing.png)")],
                    fallback_deck="Fallback",
                    request_factory=request,
                )

        self.assertIn("Local media file not found", str(raised.exception))
        self.assertFalse(col.media.added)
        self.assertFalse(col.decks.created)
        self.assertFalse(col.undo_entries)

    def test_reserved_generated_media_marker_is_rejected(self):
        col = FakeCollection()
        with self.assertRaises(service.ImportValidationError):
            service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(Path("daily.md"), "<!-- quizify-media:v1 -->")],
                fallback_deck="Fallback",
                request_factory=request,
            )
        self.assertFalse(col.undo_entries)

    def test_preflight_reports_remote_media_warning_without_copying(self):
        diagnostics = service.validate_cards(
            [
                card(
                    Path("daily.md"),
                    "![remote](https://example.invalid/image.png)",
                )
            ],
            "Fallback",
        )

        self.assertEqual(len(diagnostics), 1)
        self.assertEqual(diagnostics[0].severity, "warning")
        self.assertIn("offline", diagnostics[0].message)

    def test_failed_bulk_write_rolls_back_custom_undo_entry(self):
        col = FakeCollection(fail_add=True)

        with self.assertRaisesRegex(RuntimeError, "database failure"):
            service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(Path("daily.md"))],
                fallback_deck="Fallback",
                request_factory=request,
            )

        self.assertEqual(col.merged, [7])
        self.assertEqual(col.undo_calls, 1)

    def test_rejects_filtered_deck_and_its_children_before_writing(self):
        col = FakeCollection(filtered=("筛选",))

        with self.assertRaisesRegex(ValueError, "filtered deck"):
            service.import_cards(
                col,
                notetype_name=NOTETYPE["name"],
                cards=[card(Path("daily.md"), deck="筛选::子牌组")],
                fallback_deck="Fallback",
                request_factory=request,
            )

        self.assertFalse(col.undo_entries)
        self.assertFalse(col.media.added)


if __name__ == "__main__":
    unittest.main()
