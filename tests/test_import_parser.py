import importlib.util
from pathlib import Path
import sys
import unittest


PARSER_PATH = (
    Path(__file__).resolve().parents[1]
    / "quizify_addon"
    / "importer"
    / "parser.py"
)
spec = importlib.util.spec_from_file_location("quizify_import_parser", PARSER_PATH)
parser = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = parser
spec.loader.exec_module(parser)


def codes(result):
    return [diagnostic.code for diagnostic in result.diagnostics]


class ImportParserTest(unittest.TestCase):
    def test_parses_cards_and_keeps_horizontal_rule_as_content(self):
        value = """+++

# 正面

现在是正面

> 这里在正面显示

***

# 背面

现在是背面

---

依然是背面

+++

现在是新卡片的正面

***

还有背面
"""
        result = parser.parse_document(value, "daily.md")

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertEqual(len(result.cards), 2)
        self.assertEqual(
            result.cards[0].front,
            "# 正面\n\n现在是正面\n\n> 这里在正面显示",
        )
        self.assertEqual(
            result.cards[0].back,
            "# 背面\n\n现在是背面\n\n---\n\n依然是背面",
        )
        self.assertEqual(result.cards[1].front, "现在是新卡片的正面")
        self.assertEqual(result.cards[1].back, "还有背面")
        self.assertEqual(result.cards[0].start_line, 1)
        self.assertEqual(result.cards[0].front_line, 3)
        self.assertEqual(result.cards[0].separator_line, 9)
        self.assertEqual(result.cards[0].back_line, 11)
        self.assertEqual(result.source_name, "daily.md")

    def test_document_and_card_configuration_merge_with_media(self):
        value = """---
title: ignored by Quizify
quizify:
  deck: "学习::网络"
  tags: [network, shared, network]
  media:
    local: copy
    remote: keep
    roots:
      - ./assets
      - './audio files'
unrelated:
  malformed for another tool
---

+++

<!-- quizify-card
deck: '学习::网络::TCP'
tags:
  - tcp
  - shared
draft: true
-->

Front
***
Back
"""
        result = parser.parse_document(value)

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertEqual(result.config.format_version, 1)
        self.assertEqual(result.config.deck, "学习::网络")
        self.assertEqual(result.config.tags, ("network", "shared"))
        self.assertEqual(result.config.media.local, "copy")
        self.assertEqual(result.config.media.remote, "keep")
        self.assertEqual(
            result.config.media.roots, ("./assets", "./audio files")
        )
        card = result.cards[0]
        self.assertEqual(card.deck, "学习::网络::TCP")
        self.assertEqual(card.tags, ("network", "shared", "tcp"))
        self.assertTrue(card.draft)
        self.assertEqual(card.front, "Front")
        self.assertEqual(card.back, "Back")
        self.assertEqual(card.front_line, 26)
        self.assertEqual(card.back_line, 28)

    def test_format_is_optional_but_rejects_unsupported_versions(self):
        default = parser.parse_document(
            "---\nquizify:\n  deck: Test\n---\n+++\nF\n***\nB"
        )
        self.assertEqual(default.config.format_version, 1)
        self.assertNotIn("invalid_format", codes(default))

        unsupported = parser.parse_document(
            "---\nquizify:\n  format: 2\n---\n+++\nF\n***\nB"
        )
        self.assertTrue(unsupported.has_errors)
        self.assertIn("unsupported_format", codes(unsupported))
        self.assertEqual(unsupported.errors[0].line, 3)

    def test_unknown_quizify_and_card_keys_warn_but_top_level_yaml_is_ignored(self):
        value = """---
other_tool: [this is deliberately ignored
quizify:
  deck: Test
  typo: ignored
---
+++
<!-- quizify-card
difficulty: hard
-->
F
***
B"""
        result = parser.parse_document(value)

        self.assertFalse(result.has_errors, result.diagnostics)
        unknown = [
            item for item in result.warnings if item.code == "unknown_config_key"
        ]
        self.assertEqual(len(unknown), 2)
        self.assertEqual([item.line for item in unknown], [5, 9])

    def test_fences_math_blocks_and_escaped_delimiters_are_content(self):
        value = r"""+++
Before
```text
+++
***
```
~~~text
+++
***
~~~
$$
+++
***
$$
\+++
\***
***
Back"""
        result = parser.parse_document(value)

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertEqual(len(result.cards), 1)
        self.assertIn("```text\n+++\n***\n```", result.cards[0].front)
        self.assertIn("~~~text\n+++\n***\n~~~", result.cards[0].front)
        self.assertIn("$$\n+++\n***\n$$", result.cards[0].front)
        self.assertTrue(result.cards[0].front.endswith("+++\n***"))
        self.assertEqual(result.cards[0].back, "Back")

    def test_markers_require_the_whole_unindented_line(self):
        value = """+++
  +++
> ***
+++ more
***
Back"""
        result = parser.parse_document(value)

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertEqual(result.cards[0].front, "  +++\n> ***\n+++ more")

    def test_reports_missing_multiple_and_empty_fields_with_lines(self):
        value = """+++
No back separator
+++
***
Back only
+++
Front only
***
+++
"""
        result = parser.parse_document(value, "broken.md")

        self.assertTrue(result.has_errors)
        self.assertEqual(
            codes(result),
            [
                "missing_back_separator",
                "empty_front",
                "empty_back",
                "empty_card",
            ],
        )
        self.assertEqual(result.diagnostics[0].line, 1)
        self.assertEqual(result.diagnostics[1].line, 3)
        self.assertEqual(result.diagnostics[2].line, 8)
        self.assertEqual(result.diagnostics[3].line, 9)
        self.assertTrue(
            all(item.source_name == "broken.md" for item in result.diagnostics)
        )

        multiple = parser.parse_document("+++\nF\n***\nB\n***\nB2")
        self.assertIn("multiple_back_separators", codes(multiple))
        diagnostic = next(
            item
            for item in multiple.diagnostics
            if item.code == "multiple_back_separators"
        )
        self.assertEqual(diagnostic.line, 5)
        self.assertEqual(diagnostic.card_index, 1)

    def test_content_before_first_card_and_missing_cards_are_errors(self):
        result = parser.parse_document("preface\n+++\nF\n***\nB")
        self.assertIn("content_before_first_card", codes(result))
        self.assertEqual(result.errors[0].line, 1)

        empty = parser.parse_document("\n")
        self.assertEqual(codes(empty), ["no_cards"])

        unexpected = parser.parse_document("***\n+++\nF\n***\nB")
        self.assertIn("unexpected_back_separator", codes(unexpected))

    def test_only_a_leading_card_comment_is_configuration(self):
        value = """+++
<!-- ordinary -->
<!-- quizify-card
draft: true
-->
F
***
B"""
        result = parser.parse_document(value)

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertFalse(result.cards[0].draft)
        self.assertIn("<!-- quizify-card", result.cards[0].front)

    def test_malformed_yaml_is_diagnosed_without_external_yaml_library(self):
        invalid_tags = parser.parse_document(
            "---\nquizify:\n  tags: one-tag\n---\n+++\nF\n***\nB"
        )
        self.assertIn("invalid_config_value", codes(invalid_tags))

        unclosed = parser.parse_document("---\nquizify:\n  deck: Test")
        self.assertIn("unclosed_front_matter", codes(unclosed))

        tabbed = parser.parse_document(
            "---\nquizify:\n\tdeck: Test\n---\n+++\nF\n***\nB"
        )
        self.assertIn("yaml_tab_indentation", codes(tabbed))

        unsupported_remote = parser.parse_document(
            "---\nquizify:\n  media:\n    remote: download\n---\n"
            "+++\nF\n***\nB"
        )
        self.assertIn("invalid_media_mode", codes(unsupported_remote))
        self.assertEqual(unsupported_remote.config.media.remote, "keep")

    def test_tags_reject_whitespace_but_media_roots_allow_it(self):
        result = parser.parse_document(
            "---\n"
            "quizify:\n"
            "  tags: [valid, 'two words']\n"
            "  media:\n"
            "    roots: ['./media files']\n"
            "---\n"
            "+++\n"
            "<!-- quizify-card\n"
            "tags: [card-tag, 'bad\ttag']\n"
            "-->\n"
            "F\n"
            "***\n"
            "B"
        )

        invalid_tags = [
            item for item in result.errors if item.code == "invalid_tag"
        ]
        self.assertEqual(len(invalid_tags), 2)
        self.assertEqual([item.line for item in invalid_tags], [3, 9])
        self.assertEqual(result.config.tags, ("valid",))
        self.assertEqual(result.config.media.roots, ("./media files",))
        self.assertEqual(result.cards[0].tags, ("valid", "card-tag"))

    def test_bom_crlf_and_trailing_spaces_on_markers_are_supported(self):
        result = parser.parse_document(
            "\ufeff+++  \r\nFront\r\n***\t\r\nBack\r\n"
        )

        self.assertFalse(result.has_errors, result.diagnostics)
        self.assertEqual(result.cards[0].front, "Front")
        self.assertEqual(result.cards[0].back, "Back")


if __name__ == "__main__":
    unittest.main()
