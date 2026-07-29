import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BUILD_PATH = PROJECT_ROOT / "tools" / "build_addon.py"
spec = importlib.util.spec_from_file_location("quizify_build_addon", BUILD_PATH)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

EXPECTED_PACKAGE_MEMBERS = {
    "__init__.py",
    "_persistence.js",
    "_quizify.css",
    "_quizify-i18n.js",
    "_quizify.js",
    "bridge.py",
    "config.json",
    "configuration.py",
    "core.py",
    "importer/__init__.py",
    "importer/dialog.py",
    "importer/media.py",
    "importer/parser.py",
    "importer/service.py",
    "i18n.py",
    "licenses/DOMPurify-Apache-LICENSE.txt",
    "licenses/DOMPurify-MPL-LICENSE.txt",
    "licenses/anki-persistence-LICENSE.txt",
    "licenses/highlight.js-LICENSE.txt",
    "licenses/katex-LICENSE.txt",
    "licenses/lucide-ISC-LICENSE.txt",
    "licenses/marked-LICENSE.txt",
    "manifest.json",
    "media-manifest.json",
    "media.py",
    "locales/en.json",
    "locales/ru.json",
    "locales/zh-CN.json",
    "notetype.py",
    "package.json",
    "settings.py",
    "templates/back.html",
    "templates/front.html",
    "THIRD_PARTY_LICENSES.md",
    "user_files/README.txt",
    "web/editor-preview.js",
    "web/editor.css",
    "web/editor.js",
    "web/syntax-tools.js",
}


class PackageTest(unittest.TestCase):
    def test_repository_normalizes_text_payloads_for_cross_platform_builds(self):
        attributes = (builder.PROJECT_ROOT / ".gitattributes").read_text(
            encoding="utf-8"
        )
        self.assertIn("* text=auto eol=lf", attributes)
        self.assertIn("*.ankiaddon binary", attributes)

    def test_release_surfaces_match_manifest_version(self):
        manifest = json.loads(
            (builder.ADDON_ROOT / "manifest.json").read_text(encoding="utf-8")
        )
        version = manifest["version"]
        project = json.loads(
            (builder.PROJECT_ROOT / "package.json").read_text(encoding="utf-8")
        )
        lock = json.loads(
            (builder.PROJECT_ROOT / "package-lock.json").read_text(encoding="utf-8")
        )
        readme = (builder.PROJECT_ROOT / "README.md").read_text(encoding="utf-8")
        preview = (builder.PROJECT_ROOT / "docs" / "workbench-preview.html").read_text(
            encoding="utf-8"
        )
        release_notes = (
            builder.PROJECT_ROOT / "docs" / "release-description.md"
        ).read_text(encoding="utf-8")
        self.assertEqual(manifest["human_version"], version)
        self.assertEqual(manifest["min_point_version"], 250900)
        self.assertEqual(manifest["mod"], 2026073001)
        self.assertEqual(project["version"], version)
        self.assertEqual(lock["version"], version)
        self.assertEqual(lock["packages"][""]["version"], version)
        self.assertEqual(lock["packages"][""]["engines"], project["engines"])
        self.assertIn(f"当前版本为 **{version}**", readme)
        self.assertIn(f'<span class="version">v{version}</span>', preview)
        self.assertIn(f"## {version} 更新", release_notes)

    def test_editor_assets_use_addon_version_cache_busting(self):
        source = (builder.ADDON_ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertIn("syntax-tools.js?v={ADDON_VERSION}", source)
        self.assertIn('"v": ADDON_VERSION', source)
        self.assertIn('"quizify": "1"', source)
        self.assertIn("editor.js?{editor_query}", source)
        self.assertIn("editor.css?v={ADDON_VERSION}", source)

    def test_package_filter_is_an_explicit_allowlist(self):
        self.assertEqual(set(builder.PACKAGE_MEMBERS), EXPECTED_PACKAGE_MEMBERS)
        self.assertTrue(builder.should_package(Path("__init__.py")))
        self.assertTrue(
            builder.should_package(
                Path("_quizify-katex-KaTeX_Main-Regular-EXAMPLE.woff2")
            )
        )
        self.assertFalse(builder.should_package(Path("quizify.ankiaddon")))
        self.assertFalse(builder.should_package(Path("quizify.ankiaddon.building")))
        self.assertFalse(builder.should_package(Path(".env")))
        self.assertFalse(builder.should_package(Path(".DS_Store")))
        self.assertFalse(builder.should_package(Path("debug.log")))
        self.assertFalse(builder.should_package(Path("secrets.json")))
        self.assertFalse(builder.should_package(Path("web/editor.js.map")))
        self.assertFalse(builder.should_package(Path("../manifest.json")))
        self.assertFalse(builder.should_package(builder.ADDON_ROOT / "manifest.json"))

    def test_build_creates_flat_clean_current_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "quizify-first.ankiaddon"
            second = Path(tmp) / "quizify-second.ankiaddon"
            builder.build(first)
            builder.build(second)

            self.assertEqual(first.read_bytes(), second.read_bytes())

            with ZipFile(first) as archive:
                names = archive.namelist()
                expected = set(EXPECTED_PACKAGE_MEMBERS)
                expected.update(
                    path.name
                    for path in builder.ADDON_ROOT.iterdir()
                    if path.is_file()
                    and not path.is_symlink()
                    and builder.KATEX_FONT_NAME.fullmatch(path.name)
                )
                self.assertEqual(names, sorted(expected))

                for info in archive.infolist():
                    self.assertEqual(info.date_time, builder.ZIP_TIMESTAMP, info.filename)
                    self.assertEqual(
                        info.create_system,
                        builder.ZIP_CREATE_SYSTEM,
                        info.filename,
                    )
                    self.assertEqual(
                        info.external_attr >> 16,
                        builder.ZIP_FILE_MODE,
                        info.filename,
                    )

                packaged_manifest = json.loads(archive.read("manifest.json"))
                source_manifest = json.loads(
                    (builder.ADDON_ROOT / "manifest.json").read_text(encoding="utf-8")
                )
                self.assertEqual(packaged_manifest, source_manifest)


if __name__ == "__main__":
    unittest.main()
