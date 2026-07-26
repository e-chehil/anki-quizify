from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from helpers import load_module


dialog = load_module("importer.dialog")


class ImportDialogPureTest(unittest.TestCase):
    def test_reads_utf8_bom_and_maps_parser_records_to_service_cards(self):
        source = """---
quizify:
  deck: Study
  tags: [document]
  media:
    local: keep
    remote: error
    roots: [assets]
---
+++
<!-- quizify-card
deck: Study::Child
tags: [card]
draft: true
-->
Front
***
Back
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "daily.md"
            path.write_text("\ufeff" + source, encoding="utf-8")

            documents = dialog.load_markdown_documents([path])
            cards = dialog.map_import_cards(documents)

        self.assertEqual(len(documents), 1)
        self.assertIsNone(documents[0].load_error)
        self.assertFalse(documents[0].has_errors)
        self.assertEqual(len(cards), 1)
        card = cards[0]
        self.assertEqual(card.source_path, path)
        self.assertEqual(card.source_line, 10)
        self.assertEqual(card.front_line, 16)
        self.assertEqual(card.back_line, 18)
        self.assertEqual(card.front, "Front")
        self.assertEqual(card.back, "Back")
        self.assertEqual(card.deck, "Study::Child")
        self.assertEqual(card.tags, ("document", "card"))
        self.assertTrue(card.draft)
        self.assertEqual(card.media_roots, ("assets",))
        self.assertEqual(card.local_media, "keep")
        self.assertEqual(card.remote_media, "error")

    def test_keeps_loading_other_files_when_one_cannot_be_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            valid = root / "valid.md"
            valid.write_text("+++\nFront\n***\nBack", encoding="utf-8")
            missing = root / "missing.md"

            documents = dialog.load_markdown_documents([missing, valid])

        self.assertEqual(len(documents), 2)
        self.assertTrue(documents[0].has_errors)
        self.assertIn("无法读取文件", documents[0].load_error)
        self.assertFalse(documents[1].has_errors)
        self.assertEqual(len(dialog.map_import_cards(documents)), 1)

    def test_extra_tags_accept_spaces_and_commas_and_deduplicate(self):
        self.assertEqual(
            dialog.parse_extra_tags("alpha beta,alpha，gamma\nnext"),
            ("alpha", "beta", "gamma", "next"),
        )

    def test_deck_choices_exclude_filtered_and_do_not_default_to_one(self):
        class Decks:
            def all_names_and_ids(self, *, include_filtered):
                self.include_filtered = include_filtered
                return [SimpleNamespace(name="Default"), SimpleNamespace(name="Study")]

            def current(self):
                return {"name": "Filtered"}

        collection = SimpleNamespace(decks=Decks())
        names = dialog._deck_names(collection)

        self.assertFalse(collection.decks.include_filtered)
        self.assertEqual(names, ["Default", "Study"])
        self.assertEqual(dialog._current_deck_name(collection, names), "Default")


if __name__ == "__main__":
    unittest.main()
