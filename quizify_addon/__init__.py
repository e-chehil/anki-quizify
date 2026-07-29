from __future__ import annotations

from copy import deepcopy
from html import escape as escape_html
import json
from pathlib import Path
import re
from urllib.parse import urlencode

from aqt import gui_hooks, mw
from aqt.editor import Editor
from aqt.qt import QAction, QMimeData
from aqt.webview import WebContent

from .bridge import handle_reviewer_message
from .configuration import (
    DEFAULT_NOTE_TYPE,
    DEVELOPER_CONTACT,
    get_config as load_config,
    migrate_config,
    note_type_name as configured_note_type_name,
    normalize_review_theme,
)
from .core import (
    html_to_markdown,
    normalize_editor_content,
    protect_quizify_source_regions,
    run_isolated_steps,
    source_error_html,
)
from .media import sync_media as sync_media_files
from .notetype import MANAGED_TEMPLATE_MARKER, ensure_notetype as ensure_model
from .i18n import current_locale, tr


ADDON_DIR = Path(__file__).parent
NOTETYPE = DEFAULT_NOTE_TYPE
MENU = "Quizify Markdown"
ADDON_MODULE = __name__.split(".")[0]


def read(name: str) -> str:
    return (ADDON_DIR / name).read_text(encoding="utf-8")


def addon_metadata() -> dict:
    return json.loads(read("manifest.json"))


ADDON_VERSION = str(addon_metadata().get("version", "unknown"))


def default_config() -> dict:
    return json.loads(read("config.json"))


def get_config() -> dict:
    return load_config(mw, ADDON_DIR, ADDON_MODULE)


def note_type_name(config: dict | None = None) -> str:
    return configured_note_type_name(config or get_config())


def is_quizify_notetype(notetype) -> bool:
    return bool(notetype and notetype.get("name") == note_type_name())


def on_munge_html(txt: str, editor: Editor) -> str:
    if not editor.note or not is_quizify_notetype(editor.note.note_type()):
        return txt
    return normalize_editor_content(txt)


def on_editor_will_process_mime(
    mime: QMimeData,
    editor_web_view,
    internal: bool,
    extended: bool,
    drop_event: bool,
) -> QMimeData:
    """Turn an external rich-text paste into inert Markdown source.

    Image and URL payloads remain Anki's responsibility so its media importer
    can download/copy them.  Internal field pastes also retain Anki's lossless
    path.  Both text/plain and escaped text/html are supplied because editor
    implementations differ in which flavor they prefer.
    """
    try:
        editor = getattr(editor_web_view, "editor", None)
        note = getattr(editor, "note", None)
        if (
            internal
            or note is None
            or not is_quizify_notetype(note.note_type())
            or not mime.hasHtml()
            or mime.hasImage()
            or mime.hasUrls()
        ):
            return mime
        rich_html = mime.html()
        if not rich_html or re.search(r"<\s*img\b", rich_html, re.IGNORECASE):
            return mime

        markdown = html_to_markdown(rich_html)
        copied = QMimeData()
        for format_name in mime.formats():
            copied.setData(format_name, mime.data(format_name))
        copied.setText(markdown)
        safe_html = escape_html(markdown).replace("\r\n", "\n").replace("\r", "\n")
        copied.setHtml(safe_html.replace("\n", "<br>"))
        return copied
    except Exception:
        # Paste hooks must fail open to Anki's normal, media-aware processing.
        return mime


def sync_media() -> list[str]:
    return sync_media_files(mw, ADDON_DIR)


def ensure_notetype(
    config: dict | None = None, *, persist_config: bool = True
) -> str:
    effective = deepcopy(config) if config is not None else get_config()
    actual_name = ensure_model(mw, ADDON_DIR, effective)
    if actual_name != configured_note_type_name(effective):
        effective["note_type"] = actual_name
        if persist_config:
            mw.addonManager.writeConfig(ADDON_MODULE, effective)
    return actual_name


def on_card_will_show(text: str, card, kind: str) -> str:
    """Escape only fields delimited by a Quizify-owned rendered template."""
    if MANAGED_TEMPLATE_MARKER not in text:
        return text
    error_html = source_error_html()
    if text.count(MANAGED_TEMPLATE_MARKER) != 1:
        return error_html
    normalized_kind = str(kind or "").lower()
    expected_sides = (
        ("front", "back")
        if "answer" in normalized_kind
        else ("front",)
        if "question" in normalized_kind
        else None
    )
    protected = protect_quizify_source_regions(
        text, expected_sides, error_html=error_html
    )
    if protected == error_html:
        return protected
    if "<!-- quizify-source:safe:front -->" not in protected:
        return error_html
    locale_script = (
        '<script id="quizify-runtime-locale">globalThis.quizifyLocale='
        f"{json.dumps(current_locale())};</script>"
    )
    if 'id="quizify-runtime-locale"' not in protected:
        protected = locale_script + protected
    return protected


def on_webview_set_content(content: WebContent, context) -> None:
    if not isinstance(context, Editor):
        return
    addon = mw.addonManager.addonFromModule(__name__)
    config = get_config()
    notetype = mw.col.models.by_name(note_type_name(config)) if mw.col else None
    fields = notetype.get("flds", []) if notetype else []
    plain_indices = ",".join(
        str(index)
        for index, field in enumerate(fields)
        if field.get("name") in {"Front", "Back"}
    )
    editor_query = urlencode(
        {
            "v": ADDON_VERSION,
            "quizify": "1",
            "ntid": str(notetype.get("id", "")) if notetype else "",
            "plain": plain_indices,
            "theme": normalize_review_theme(
                config.get("review", {}).get("theme")
                if isinstance(config.get("review"), dict)
                else None
            ),
            "lang": current_locale(),
        }
    )
    content.js.extend(
        [
            f"/_addons/{addon}/_quizify-i18n.js?v={ADDON_VERSION}",
            f"/_addons/{addon}/web/syntax-tools.js?v={ADDON_VERSION}&lang={current_locale()}",
            f"/_addons/{addon}/web/editor.js?{editor_query}",
        ]
    )
    content.css.append(f"/_addons/{addon}/web/editor.css?v={ADDON_VERSION}")


def on_editor_load_note(editor: Editor) -> None:
    if not editor.note:
        return
    action = (
        "quizifyEditorActivate"
        if is_quizify_notetype(editor.note.note_type())
        else "quizifyEditorDeactivate"
    )
    editor.web.eval(f"window.{action} && {action}()")


def on_js_message(handled, message: str, context):
    return handle_reviewer_message(handled, message, context, mw)


def add_menu() -> None:
    if getattr(mw, "_quizify_md_menu", None):
        return
    menu = getattr(getattr(mw, "form", None), "menuTools", None)
    if not menu:
        return
    submenu = menu.addMenu(MENU)
    import_action = QAction(tr("menu.import_markdown"), mw)
    import_action.triggered.connect(lambda _=False: show_markdown_import())
    submenu.addAction(import_action)
    submenu.addSeparator()
    settings_action = QAction(tr("menu.settings"), mw)
    settings_action.triggered.connect(lambda _=False: show_settings())
    submenu.addAction(settings_action)
    mw._quizify_md_menu = submenu


def show_settings() -> None:
    from .settings import show_settings as show

    show()


def show_markdown_import() -> None:
    from .importer.dialog import show_import_dialog

    show_import_dialog()


def _show_warning(message: str) -> None:
    try:
        from aqt.utils import showWarning

        showWarning(message)
    except Exception:
        pass


def _warn_if_unsupported() -> None:
    try:
        from anki.utils import point_version

        if point_version() < 250900:
            _show_warning(
                tr("startup.unsupported", version=ADDON_VERSION)
            )
    except Exception:
        pass


def on_profile_loaded() -> None:
    failures = run_isolated_steps(
        [
            (
                tr("startup.step.web_exports"),
                lambda: mw.addonManager.setWebExports(
                    __name__, r"(web/.*|_quizify.*|_persistence\.js)"
                ),
            ),
            (
                tr("startup.step.settings"),
                lambda: mw.addonManager.setConfigAction(__name__, show_settings),
            ),
            (tr("startup.step.menu"), add_menu),
            (
                tr("startup.step.config"),
                lambda: migrate_config(mw, ADDON_DIR, ADDON_MODULE),
            ),
            (tr("startup.step.media"), sync_media),
            (tr("startup.step.template"), ensure_notetype),
        ]
    )
    _warn_if_unsupported()
    if failures:
        details = "\n".join(f"- {label}: {error}" for label, error in failures)
        _show_warning(tr("startup.partial_failure", details=details))


gui_hooks.profile_did_open.append(on_profile_loaded)
gui_hooks.editor_will_munge_html.append(on_munge_html)
gui_hooks.editor_will_process_mime.append(on_editor_will_process_mime)
gui_hooks.card_will_show.append(on_card_will_show)
gui_hooks.webview_will_set_content.append(on_webview_set_content)
gui_hooks.editor_did_load_note.append(on_editor_load_note)
gui_hooks.webview_did_receive_js_message.append(on_js_message)
