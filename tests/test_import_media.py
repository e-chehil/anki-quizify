from pathlib import Path
import tempfile
import unittest

from helpers import load_module


media = load_module("importer.media")


class ImportMediaTest(unittest.TestCase):
    def test_finds_images_and_quizify_audio_outside_protected_blocks(self):
        text = """![one](assets/one.png)
`![inline](ignored.png)`
```markdown
![code](ignored.png)
```
$$
![math](ignored.png)
$$
!audio[clip](audio/test.mp3)
"""

        refs = media.find_media_references(text)

        self.assertEqual(
            [(item.kind, item.target, item.line) for item in refs],
            [
                ("image", "assets/one.png", 1),
                ("audio", "audio/test.mp3", 9),
            ],
        )

    def test_copies_relative_media_and_rewrites_only_imported_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "notes.md"
            assets = root / "assets"
            assets.mkdir()
            image = assets / "示例 图片.png"
            image.write_bytes(b"image")
            source.write_text("source", encoding="utf-8")
            added = []

            rewriter = media.MediaRewriter(
                lambda path: added.append(Path(path)) or "anki-image.png"
            )
            original = "![示例](<assets/%E7%A4%BA%E4%BE%8B%20%E5%9B%BE%E7%89%87.png>)"
            result = rewriter.rewrite(original, source_path=source)

            self.assertEqual(result.text, "![示例](<anki-image.png>)")
            self.assertEqual(added, [image])
            self.assertEqual(result.copied, ("anki-image.png",))
            self.assertFalse(result.has_errors)

    def test_reuses_copied_file_and_reports_remote_media(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "notes.md"
            image = root / "one.png"
            image.write_bytes(b"same")
            calls = []
            rewriter = media.MediaRewriter(
                lambda path: calls.append(path) or "one.png"
            )
            text = (
                "![a](one.png) ![b](one.png)\n"
                "![remote](https://example.invalid/image.png)"
            )

            result = rewriter.rewrite(text, source_path=source)

            self.assertEqual(len(calls), 1)
            self.assertEqual(result.copied, ("one.png",))
            self.assertEqual(len(result.diagnostics), 1)
            self.assertEqual(result.diagnostics[0].severity, "warning")

    def test_rejects_missing_absolute_and_out_of_root_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            notes = root / "notes"
            outside = root / "outside"
            notes.mkdir()
            outside.mkdir()
            (outside / "secret.png").write_bytes(b"secret")
            source = notes / "notes.md"
            source.write_text("", encoding="utf-8")
            rewriter = media.MediaRewriter(lambda path: Path(path).name)

            result = rewriter.rewrite(
                "![outside](../outside/secret.png)\n![missing](missing.png)",
                source_path=source,
            )

            self.assertTrue(result.has_errors)
            self.assertEqual(len(result.diagnostics), 2)
            self.assertIn("超出允许目录", result.diagnostics[0].message)
            self.assertIn("找不到", result.diagnostics[1].message)

            configured_outside = rewriter.rewrite(
                "![outside](../outside/secret.png)",
                source_path=source,
                roots=("../outside",),
            )
            self.assertTrue(configured_outside.has_errors)
            self.assertIn(
                "不得超出 Markdown 所在目录",
                configured_outside.diagnostics[0].message,
            )

    def test_rejects_url_and_drive_relative_media_roots(self):
        result = media.MediaRewriter(lambda path: Path(path).name).rewrite(
            "Front",
            source_path=Path("notes.md"),
            roots=("https://example.invalid/assets", "C:assets"),
        )

        self.assertTrue(result.has_errors)
        self.assertEqual(len(result.diagnostics), 2)
        self.assertTrue(
            all("只允许相对路径" in item.message for item in result.diagnostics)
        )

    def test_ignores_escaped_and_commented_media_and_strictly_closes_fences(self):
        value = r"""\![escaped](ignored.png)
<!-- ![commented](ignored.png) -->
<!--
```commented-fence
![also-commented](ignored.png)
-->
```markdown
```not-a-close
![still-code](ignored.png)
```
    ![indented-code](ignored.png)
![visible](visible.png)
"""

        refs = media.find_media_references(value)

        self.assertEqual(
            [(item.kind, item.target, item.line) for item in refs],
            [("image", "visible.png", 12)],
        )

    def test_protocol_relative_remote_media_is_kept_with_warning(self):
        result = media.MediaRewriter(lambda _path: "unused").rewrite(
            "![remote](//cdn.example.invalid/image.png)",
            source_path=Path("notes.md"),
        )

        self.assertEqual(result.text, "![remote](//cdn.example.invalid/image.png)")
        self.assertEqual(result.diagnostics[0].severity, "warning")

    def test_comment_syntax_inside_code_span_does_not_hide_later_media(self):
        refs = media.find_media_references(
            "`<!-- not a comment` ![visible](visible.png)"
        )

        self.assertEqual(
            [(item.kind, item.target) for item in refs],
            [("image", "visible.png")],
        )

    def test_rewritten_destination_is_url_encoded(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "notes.md"
            (root / "original.png").write_bytes(b"image")
            result = media.MediaRewriter(
                lambda _path: "renamed image (1).png"
            ).rewrite("![x](original.png)", source_path=source)

        self.assertEqual(result.text, "![x](renamed%20image%20%281%29.png)")

    def test_markdown_escaped_local_filename_is_resolved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "notes.md"
            expected = root / "image(1).png"
            expected.write_bytes(b"image")
            added = []
            result = media.MediaRewriter(
                lambda path: added.append(Path(path)) or "image(1).png"
            ).rewrite(r"![x](image\(1\).png)", source_path=source)

        self.assertEqual(added, [expected])
        self.assertEqual(result.text, "![x](image%281%29.png)")

    def test_unclosed_markdown_media_syntax_is_not_imported(self):
        refs = media.find_media_references("![broken](image.png")

        self.assertEqual(refs, ())

    def test_manifest_is_inert_and_tracks_each_imported_file_once(self):
        value = media.append_media_manifest(
            "Front",
            [
                media.ImportedMedia("image", "a&b.png"),
                media.ImportedMedia("image", "a&b.png"),
                media.ImportedMedia("audio", "voice.mp3"),
            ],
        )

        self.assertTrue(value.startswith("Front\n\n<!-- quizify-media:v1\n"))
        self.assertEqual(value.count("a&amp;b.png"), 1)
        self.assertIn('<img src="a&amp;b.png">', value)
        self.assertIn('<audio src="voice.mp3"></audio>', value)
        self.assertNotIn("[sound:", value)
        self.assertTrue(value.endswith("\n-->"))


if __name__ == "__main__":
    unittest.main()
