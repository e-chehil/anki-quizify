import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


CORE_PATH = Path(__file__).resolve().parents[1] / "quizify_addon" / "core.py"
spec = importlib.util.spec_from_file_location("quizify_core", CORE_PATH)
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class CoreTest(unittest.TestCase):
    def test_config_merge_preserves_nested_defaults(self):
        defaults = {
            "cardless": False,
            "assets": {
                "marked": {"local": "_marked.js", "cdn": "https://old.invalid"}
            },
        }
        merged = core.merge_config(
            defaults,
            {"cardless": True, "assets": {"marked": {"cdn": "https://new.invalid"}}},
        )

        self.assertTrue(merged["cardless"])
        self.assertEqual(merged["assets"]["marked"]["local"], "_marked.js")
        self.assertEqual(merged["assets"]["marked"]["cdn"], "https://new.invalid")
        self.assertFalse(defaults["cardless"])

    def test_config_merge_ignores_invalid_nested_container(self):
        defaults = {"assets": {"marked": {"local": "_marked.js"}}}
        self.assertEqual(core.merge_config(defaults, {"assets": []}), defaults)

    def test_config_json_cannot_close_script_element(self):
        value = {"text": "</script><img src=x>&\u2028next"}
        encoded = core.config_json_for_html(value)

        self.assertNotIn("</script", encoded.lower())
        self.assertNotIn("<", encoded)
        self.assertNotIn("&", encoded)
        self.assertEqual(json.loads(encoded), value)

    def test_html_to_markdown_accepts_attribute_order_and_quotes(self):
        html = (
            "<img alt='图[一]' class='x' src='folder/a (1).png'>"
            "<br><strong class='hot'>重点</strong> <EM>斜体</EM>"
        )
        self.assertEqual(
            core.html_to_markdown(html),
            "![图\\[一\\]](folder/a%20%281%29.png)\n**重点** *斜体*",
        )

    def test_html_to_markdown_keeps_img_without_source(self):
        value = '<img alt="missing">'
        self.assertEqual(core.html_to_markdown(value), value)

    def test_html_to_markdown_preserves_literal_markup_inside_code(self):
        value = "<code><strong>literal</strong><br></code>"
        self.assertEqual(core.html_to_markdown(value), value)

    def test_editor_normalization_requires_an_explicit_paste_marker(self):
        existing = "Markdown with <strong>literal HTML</strong><br>"
        self.assertEqual(core.normalize_editor_content(existing), existing)

        marked = (
            "before "
            f"{core.RICH_PASTE_START}"
            "<strong>重点</strong><br><code><em>literal</em></code>"
            f"{core.RICH_PASTE_END}"
            " after"
        )
        normalized = "before **重点**\n<code><em>literal</em></code> after"
        self.assertEqual(core.normalize_editor_content(marked), normalized)
        self.assertEqual(core.normalize_editor_content(normalized), normalized)

    def test_editor_normalization_leaves_unclosed_marker_untouched(self):
        value = f"{core.RICH_PASTE_START}<strong>still source</strong>"
        self.assertEqual(core.normalize_editor_content(value), value)

    def test_card_source_regions_escape_active_html_and_mark_them_safe(self):
        start = "<!-- quizify-source:start:front -->"
        safe = "<!-- quizify-source:safe:front -->"
        end = "<!-- quizify-source:end:front -->"
        value = (
            "before"
            f"{start}"
            '<script>alert("x")</script><img src=x onerror="boom">'
            "&lt;em&gt;entity&lt;/em&gt; &amp;"
            "<br>line 2<BR />line 3&lt;br&gt;"
            f"{end}"
            "after"
        )

        protected = core.protect_quizify_source_regions(value)

        self.assertEqual(
            protected,
            "before"
            f"{safe}"
            '&lt;script&gt;alert("x")&lt;/script&gt;'
            '&lt;img src=x onerror="boom"&gt;'
            "&lt;em&gt;entity&lt;/em&gt; &amp;"
            "\nline 2\nline 3&lt;br&gt;"
            f"{end}"
            "after",
        )
        self.assertNotIn(start, protected)
        self.assertEqual(core.protect_quizify_source_regions(protected), protected)

    def test_card_source_region_cannot_be_closed_early_by_field_content(self):
        start = "<!-- quizify-source:start:front -->"
        end = "<!-- quizify-source:end:front -->"
        injected_end = end
        value = f"{start}safe{injected_end}<script>bad()</script>{end}"

        protected = core.protect_quizify_source_regions(value)

        self.assertEqual(protected, core.SOURCE_ERROR_HTML)
        self.assertNotIn("<script>", protected)

    def test_cross_field_marker_injection_fails_closed_without_note_data(self):
        value = (
            "<!-- quizify-source:start:front -->safe front"
            "<!-- quizify-source:end:front -->"
            '<div id="answer"></div>'
            "<!-- quizify-source:start:back -->safe back"
            "<!-- quizify-source:end:front -->"
            '<img src=x onerror="boom"><script>active()</script>'
            "<!-- quizify-source:end:back -->"
        )

        protected = core.protect_quizify_source_regions(
            value, ("front", "back")
        )

        self.assertEqual(protected, core.SOURCE_ERROR_HTML)
        self.assertNotIn("safe front", protected)
        self.assertNotIn("safe back", protected)
        self.assertNotIn("<img", protected)
        self.assertNotIn("<script", protected)

    def test_source_topology_rejects_unknown_or_wrong_side_markers(self):
        unknown = (
            "<!-- quizify-source:start:front -->safe"
            "<!-- quizify-source:end:front -->"
            "<!-- quizify-source:start:evil -->bad"
            "<!-- quizify-source:end:evil -->"
        )
        self.assertEqual(
            core.protect_quizify_source_regions(unknown, ("front",)),
            core.SOURCE_ERROR_HTML,
        )

        back_on_question = (
            "<!-- quizify-source:start:front -->safe"
            "<!-- quizify-source:end:front -->"
            "<!-- quizify-source:start:back -->bad"
            "<!-- quizify-source:end:back -->"
        )
        self.assertEqual(
            core.protect_quizify_source_regions(back_on_question, ("front",)),
            core.SOURCE_ERROR_HTML,
        )

    def test_card_source_regions_leave_unmarked_html_untouched(self):
        value = '<script>alert(1)</script><img src=x onerror="boom">'
        self.assertEqual(core.protect_quizify_source_regions(value), value)

    def test_isolated_steps_keep_order_and_continue_after_failures(self):
        events = []

        def broken():
            events.append("broken")
            raise RuntimeError("boom")

        failures = core.run_isolated_steps(
            [
                ("first", lambda: events.append("first")),
                ("broken step", broken),
                ("last", lambda: events.append("last")),
            ]
        )

        self.assertEqual(events, ["first", "broken", "last"])
        self.assertEqual(failures, [("broken step", "RuntimeError: boom")])

    def test_files_identical_compares_content_not_only_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.js"
            target = root / "target.js"
            source.write_bytes(b"abcd")
            target.write_bytes(b"abcd")
            self.assertTrue(core.files_identical(source, target))
            target.write_bytes(b"abce")
            self.assertFalse(core.files_identical(source, target))


if __name__ == "__main__":
    unittest.main()
