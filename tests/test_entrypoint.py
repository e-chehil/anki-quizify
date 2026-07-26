import importlib.util
from pathlib import Path
import sys
import types
import unittest
from urllib.parse import parse_qs, urlsplit


ADDON_ROOT = Path(__file__).resolve().parents[1] / "quizify_addon"
PACKAGE = "quizify_entrypoint_test"
AQT_MODULES = ("aqt", "aqt.editor", "aqt.qt", "aqt.webview", "aqt.utils")


class FakeMimeData:
    def __init__(self):
        self._data = {}
        self._html = None
        self._text = None
        self.image = False
        self.urls = False

    def formats(self):
        return list(self._data)

    def data(self, format_name):
        return self._data[format_name]

    def setData(self, format_name, value):
        self._data[format_name] = value

    def hasHtml(self):
        return self._html is not None

    def html(self):
        return self._html or ""

    def setHtml(self, value):
        self._html = value
        self._data["text/html"] = value.encode()

    def hasText(self):
        return self._text is not None

    def text(self):
        return self._text or ""

    def setText(self, value):
        self._text = value
        self._data["text/plain"] = value.encode()

    def hasImage(self):
        return self.image

    def hasUrls(self):
        return self.urls


class EntrypointTest(unittest.TestCase):
    def setUp(self):
        self.saved_aqt = {name: sys.modules.get(name) for name in AQT_MODULES}
        for name in list(sys.modules):
            if name == PACKAGE or name.startswith(f"{PACKAGE}."):
                del sys.modules[name]

        self.events = []
        self.warnings = []
        self.menu_actions = []
        hooks = types.SimpleNamespace(
            profile_did_open=[],
            editor_will_munge_html=[],
            editor_will_process_mime=[],
            card_will_show=[],
            webview_will_set_content=[],
            editor_did_load_note=[],
            webview_did_receive_js_message=[],
        )

        events = self.events

        class Signal:
            def connect(self, callback):
                self.callback = callback

        class QAction:
            def __init__(self, label, parent):
                self.label = label
                self.parent = parent
                self.triggered = Signal()

        menu_actions = self.menu_actions

        class Submenu:
            def addAction(self, action):
                menu_actions.append(action)

            def addSeparator(self):
                menu_actions.append(None)

        class Menu:
            def addMenu(self, label):
                events.append("menu")
                self.label = label
                return Submenu()

        class AddonManager:
            def getConfig(self, module_name):
                return {}

            def writeConfig(self, module_name, config):
                events.append("write")

            def setWebExports(self, module_name, pattern):
                events.append("web")
                raise RuntimeError("web export failed")

            def setConfigAction(self, module_name, callback):
                events.append("config")

        self.mw = types.SimpleNamespace(
            addonManager=AddonManager(),
            form=types.SimpleNamespace(menuTools=Menu()),
        )

        aqt = types.ModuleType("aqt")
        aqt.gui_hooks = hooks
        aqt.mw = self.mw
        editor_module = types.ModuleType("aqt.editor")
        editor_module.Editor = type("Editor", (), {})
        qt_module = types.ModuleType("aqt.qt")
        qt_module.QAction = QAction
        qt_module.QMimeData = FakeMimeData
        webview_module = types.ModuleType("aqt.webview")
        webview_module.WebContent = type("WebContent", (), {})
        utils_module = types.ModuleType("aqt.utils")
        utils_module.showWarning = self.warnings.append

        sys.modules.update(
            {
                "aqt": aqt,
                "aqt.editor": editor_module,
                "aqt.qt": qt_module,
                "aqt.webview": webview_module,
                "aqt.utils": utils_module,
            }
        )

        spec = importlib.util.spec_from_file_location(
            PACKAGE,
            ADDON_ROOT / "__init__.py",
            submodule_search_locations=[str(ADDON_ROOT)],
        )
        self.addon = importlib.util.module_from_spec(spec)
        sys.modules[PACKAGE] = self.addon
        spec.loader.exec_module(self.addon)
        self.hooks = hooks

    def tearDown(self):
        for name in list(sys.modules):
            if name == PACKAGE or name.startswith(f"{PACKAGE}."):
                del sys.modules[name]
        for name, module in self.saved_aqt.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    def test_import_registers_all_release_critical_hooks(self):
        expected = {
            "profile_did_open": self.addon.on_profile_loaded,
            "editor_will_munge_html": self.addon.on_munge_html,
            "editor_will_process_mime": self.addon.on_editor_will_process_mime,
            "card_will_show": self.addon.on_card_will_show,
            "webview_will_set_content": self.addon.on_webview_set_content,
            "editor_did_load_note": self.addon.on_editor_load_note,
            "webview_did_receive_js_message": self.addon.on_js_message,
        }
        for hook_name, callback in expected.items():
            self.assertIn(callback, getattr(self.hooks, hook_name))

    def test_profile_startup_registers_entrypoints_first_and_isolates_failures(self):
        def fail_migration(*args):
            self.events.append("migrate")
            raise ValueError("bad config")

        def fail_sync():
            self.events.append("sync")
            raise OSError("media locked")

        self.addon.migrate_config = fail_migration
        self.addon.sync_media = fail_sync
        self.addon.ensure_notetype = lambda: self.events.append("ensure")
        self.addon._warn_if_unsupported = lambda: self.events.append("version")
        self.addon._show_warning = self.warnings.append

        self.addon.on_profile_loaded()

        self.assertEqual(
            self.events,
            ["web", "config", "menu", "migrate", "sync", "ensure", "version"],
        )
        self.assertEqual(len(self.warnings), 1)
        self.assertIn("Web 资源注册", self.warnings[0])
        self.assertIn("配置迁移", self.warnings[0])
        self.assertIn("媒体同步", self.warnings[0])

    def test_tools_menu_groups_import_and_settings_actions(self):
        self.addon.add_menu()

        actions = [action for action in self.menu_actions if action is not None]
        self.assertEqual(
            [action.label for action in actions],
            ["导入 Markdown 卡片集…", "设置…"],
        )

    def test_editor_preview_query_includes_normalized_review_theme(self):
        self.mw.addonManager.addonFromModule = lambda _module_name: "quizify"
        self.mw.col = types.SimpleNamespace(
            models=types.SimpleNamespace(
                by_name=lambda _name: {
                    "id": 42,
                    "flds": [
                        {"name": "Front"},
                        {"name": "Extra"},
                        {"name": "Back"},
                    ],
                }
            )
        )

        def editor_query(theme):
            self.addon.get_config = lambda: {
                "note_type": "Quizify Markdown",
                "review": {"theme": theme},
            }
            content = types.SimpleNamespace(js=[], css=[])
            self.addon.on_webview_set_content(content, self.addon.Editor())
            editor_url = next(url for url in content.js if "/web/editor.js?" in url)
            return parse_qs(urlsplit(editor_url).query)

        self.assertEqual(
            editor_query("gezhi"),
            {
                "v": [self.addon.ADDON_VERSION],
                "quizify": ["1"],
                "ntid": ["42"],
                "plain": ["0,2"],
                "theme": ["gezhi"],
            },
        )
        self.assertEqual(editor_query(" GEZHI ")["theme"], ["kaiwu"])

    def test_card_hook_only_processes_managed_template_source_markers(self):
        unowned = (
            "<!-- quizify-source:start:front -->"
            "<script>bad()</script>"
            "<!-- quizify-source:end:front -->"
        )
        self.assertEqual(self.addon.on_card_will_show(unowned, None, "review"), unowned)

        managed = self.addon.MANAGED_TEMPLATE_MARKER + unowned
        protected = self.addon.on_card_will_show(
            managed, None, "reviewQuestion"
        )
        self.assertIn("<!-- quizify-source:safe:front -->", protected)
        self.assertIn("&lt;script&gt;bad()&lt;/script&gt;", protected)

    def test_card_hook_fails_closed_on_duplicate_ownership_or_cross_markers(self):
        marker = self.addon.MANAGED_TEMPLATE_MARKER
        duplicate_owner = marker + marker + (
            "<!-- quizify-source:start:front -->safe"
            "<!-- quizify-source:end:front -->"
        )
        self.assertEqual(
            self.addon.on_card_will_show(
                duplicate_owner, None, "reviewQuestion"
            ),
            self.addon.SOURCE_ERROR_HTML,
        )

        cross_field = marker + (
            "<!-- quizify-source:start:front -->front"
            "<!-- quizify-source:end:front -->"
            "<!-- quizify-source:start:back -->back"
            "<!-- quizify-source:end:front -->"
            '<img src=x onerror="boom">'
            "<!-- quizify-source:end:back -->"
        )
        protected = self.addon.on_card_will_show(
            cross_field, None, "reviewAnswer"
        )
        self.assertEqual(protected, self.addon.SOURCE_ERROR_HTML)
        self.assertNotIn("<img", protected)

    def test_mime_hook_converts_only_external_media_free_quizify_html(self):
        class Note:
            def note_type(self):
                return {"name": "Quizify Markdown"}

        view = types.SimpleNamespace(editor=types.SimpleNamespace(note=Note()))
        rich = FakeMimeData()
        rich.setHtml("<strong>Bold</strong><br><em>Italic</em>")
        rich.setText("original fallback")
        rich.setData("application/x-custom", b"keep")

        converted = self.addon.on_editor_will_process_mime(
            rich, view, False, False, False
        )

        self.assertIsNot(converted, rich)
        self.assertEqual(converted.text(), "**Bold**\n*Italic*")
        self.assertEqual(converted.html(), "**Bold**<br>*Italic*")
        self.assertEqual(converted.data("application/x-custom"), b"keep")
        self.assertEqual(rich.html(), "<strong>Bold</strong><br><em>Italic</em>")

        self.assertIs(
            self.addon.on_editor_will_process_mime(
                rich, view, True, False, False
            ),
            rich,
        )
        rich.image = True
        self.assertIs(
            self.addon.on_editor_will_process_mime(
                rich, view, False, False, False
            ),
            rich,
        )
        rich.image = False
        rich.urls = True
        self.assertIs(
            self.addon.on_editor_will_process_mime(
                rich, view, False, False, False
            ),
            rich,
        )

        image_html = FakeMimeData()
        image_html.setHtml('<img src="https://example.invalid/a.png">')
        self.assertIs(
            self.addon.on_editor_will_process_mime(
                image_html, view, False, False, False
            ),
            image_html,
        )


if __name__ == "__main__":
    unittest.main()
