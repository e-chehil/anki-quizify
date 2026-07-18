from copy import deepcopy
from html import escape, unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.parse


RICH_PASTE_START = "<!--quizify-rich-paste:v1-->"
RICH_PASTE_END = "<!--/quizify-rich-paste:v1-->"
RICH_PASTE_RE = re.compile(
    re.escape(RICH_PASTE_START) + r"(.*?)" + re.escape(RICH_PASTE_END),
    re.DOTALL,
)
SOURCE_SIDES = ("front", "back")
FIELD_BREAK_RE = re.compile(r"<br\s*/?\s*>", re.IGNORECASE)
SOURCE_MARKER_RE = re.compile(
    r"<!--\s*quizify-source:(start|safe|end):([a-z0-9_-]+)\s*-->",
    re.IGNORECASE,
)
SOURCE_ERROR_HTML = (
    '<div class="quizify-source-error" role="alert">'
    "Quizify 无法安全显示此卡片：字段包含保留的源边界标记。"
    "请在编辑器中删除 quizify-source 注释后重试。"
    "</div>"
)


def merge_config(defaults: dict, stored) -> dict:
    """Merge user config without dropping newly-added nested defaults."""
    result = deepcopy(defaults)
    if not isinstance(stored, dict):
        return result

    for key, value in stored.items():
        if isinstance(result.get(key), dict):
            if isinstance(value, dict):
                result[key] = merge_config(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def config_json_for_html(config: dict) -> str:
    """Serialize JSON so it cannot terminate its application/json script tag."""
    value = json.dumps(config, ensure_ascii=False, separators=(",", ":"))
    return (
        value.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def files_identical(source: Path, target: Path) -> bool:
    """Compare media files by content, avoiding needless delete/add cycles."""
    try:
        if not target.is_file() or source.stat().st_size != target.stat().st_size:
            return False
        with source.open("rb") as left, target.open("rb") as right:
            while True:
                left_chunk = left.read(64 * 1024)
                right_chunk = right.read(64 * 1024)
                if left_chunk != right_chunk:
                    return False
                if not left_chunk:
                    return True
    except OSError:
        return False


def _image_to_markdown(raw_tag: str, attributes: list[tuple[str, str | None]]) -> str:
    attrs = {name.lower(): value or "" for name, value in attributes}
    src = attrs.get("src", "").strip()
    if not src:
        return raw_tag

    # Markdown destinations need spaces and brackets encoded to remain unambiguous.
    src = urllib.parse.quote(src, safe="/:#?&=%+@,;~_-$!*")
    alt = attrs.get("alt", "").replace("\\", "\\\\")
    alt = alt.replace("[", "\\[").replace("]", "\\]")
    return f"![{alt}]({src})"


class _RichTextToMarkdownParser(HTMLParser):
    """Convert a deliberately-marked paste fragment without touching code HTML."""

    _PROTECTED = {"code", "pre"}
    _BOLD = {"b", "strong"}
    _ITALIC = {"em", "i"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.parts: list[str] = []
        self.protected_depth = 0

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        raw = self.get_starttag_text() or f"<{tag}>"
        if self.protected_depth:
            self.parts.append(raw)
            if tag in self._PROTECTED:
                self.protected_depth += 1
            return
        if tag in self._PROTECTED:
            self.parts.append(raw)
            self.protected_depth = 1
        elif tag in self._BOLD:
            self.parts.append("**")
        elif tag in self._ITALIC:
            self.parts.append("*")
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "img":
            self.parts.append(_image_to_markdown(raw, attrs))
        else:
            self.parts.append(raw)

    def handle_startendtag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        raw = self.get_starttag_text() or f"<{tag} />"
        if self.protected_depth:
            self.parts.append(raw)
        elif tag == "br":
            self.parts.append("\n")
        elif tag == "img":
            self.parts.append(_image_to_markdown(raw, attrs))
        else:
            self.parts.append(raw)

    def handle_endtag(self, tag: str) -> None:
        raw = f"</{tag}>"
        if self.protected_depth:
            self.parts.append(raw)
            if tag in self._PROTECTED:
                self.protected_depth -= 1
            return
        if tag in self._BOLD:
            self.parts.append("**")
        elif tag in self._ITALIC:
            self.parts.append("*")
        elif tag not in {"br", "img"}:
            self.parts.append(raw)

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        self.parts.append(f"&{name};")

    def handle_charref(self, name: str) -> None:
        self.parts.append(f"&#{name};")

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")

    def handle_pi(self, data: str) -> None:
        self.parts.append(f"<?{data}>")


def html_to_markdown(content: str) -> str:
    """Convert a known rich-text fragment while preserving literal code markup."""
    parser = _RichTextToMarkdownParser()
    parser.feed("" if content is None else str(content))
    parser.close()
    return "".join(parser.parts)


def normalize_editor_content(content: str) -> str:
    """Normalize only fragments explicitly marked by the editor paste handler.

    ``editor_will_munge_html`` runs for ordinary typing and blur saves, so an
    unmarked field must be treated as the user's Markdown source of truth.
    """
    text = "" if content is None else str(content)
    return RICH_PASTE_RE.sub(lambda match: html_to_markdown(match.group(1)), text)


def protect_quizify_source_regions(
    content: str, expected_sides: tuple[str, ...] | None = None
) -> str:
    """Make marked field HTML inert before Anki sends a card to a WebView.

    Template-owned comments delimit each raw field.  Their complete topology
    is validated before any replacement: a side has exactly one ``start`` or
    idempotent ``safe`` opener and exactly one end marker, with non-overlapping
    regions in template order.  Any duplicate, unknown or cross-field marker
    fails closed to a static page that contains no note data.  This matters
    because fields are attacker-controlled and a last-match strategy alone
    can be shifted into the next field.

    Real ``br`` elements represent editor newlines; entity-encoded
    ``&lt;br&gt;`` remains literal Markdown source because entity decoding
    happens afterwards.  The opening marker becomes ``safe`` so the renderer
    can use ``textContent`` and a second hook pass is a no-op.
    """
    result = "" if content is None else str(content)
    matches = list(SOURCE_MARKER_RE.finditer(result))
    if not matches and expected_sides is None:
        return result

    allowed_markers = {
        f"<!-- quizify-source:{kind}:{side} -->"
        for side in SOURCE_SIDES
        for kind in ("start", "safe", "end")
    }
    if any(match.group(0) not in allowed_markers for match in matches):
        return SOURCE_ERROR_HTML

    detected_sides = {
        match.group(2).lower()
        for match in matches
    }
    if expected_sides is None:
        sides = tuple(side for side in SOURCE_SIDES if side in detected_sides)
    else:
        sides = tuple(expected_sides)
        if (
            not sides
            or len(set(sides)) != len(sides)
            or any(side not in SOURCE_SIDES for side in sides)
        ):
            return SOURCE_ERROR_HTML

    if detected_sides != set(sides) or len(matches) != len(sides) * 2:
        return SOURCE_ERROR_HTML

    regions: list[dict[str, int | str]] = []
    for side in sides:
        start_marker = f"<!-- quizify-source:start:{side} -->"
        safe_marker = f"<!-- quizify-source:safe:{side} -->"
        end_marker = f"<!-- quizify-source:end:{side} -->"
        start_count = result.count(start_marker)
        safe_count = result.count(safe_marker)
        end_count = result.count(end_marker)
        if (start_count, safe_count, end_count) not in {
            (1, 0, 1),
            (0, 1, 1),
        }:
            return SOURCE_ERROR_HTML

        opening = start_marker if start_count else safe_marker
        opening_start = result.find(opening)
        body_start = opening_start + len(opening)
        end_start = result.find(end_marker)
        if opening_start < 0 or end_start < body_start:
            return SOURCE_ERROR_HTML
        regions.append(
            {
                "side": side,
                "opening": opening,
                "opening_start": opening_start,
                "body_start": body_start,
                "end_start": end_start,
                "end_stop": end_start + len(end_marker),
            }
        )

    if any(
        int(regions[index]["end_stop"])
        > int(regions[index + 1]["opening_start"])
        for index in range(len(regions) - 1)
    ):
        return SOURCE_ERROR_HTML

    # Work from the end so validated offsets remain stable while both fields
    # are rewritten atomically.
    for region in reversed(regions):
        opening = str(region["opening"])
        if ":safe:" in opening:
            continue
        side = str(region["side"])
        opening_start = int(region["opening_start"])
        body_start = int(region["body_start"])
        end_start = int(region["end_start"])
        field_html = result[body_start:end_start]
        markdown_source = unescape(FIELD_BREAK_RE.sub("\n", field_html))
        safe_source = escape(markdown_source, quote=False)
        safe_marker = f"<!-- quizify-source:safe:{side} -->"
        result = (
            result[:opening_start]
            + safe_marker
            + safe_source
            + result[end_start:]
        )
    return result


def run_isolated_steps(steps) -> list[tuple[str, str]]:
    """Run ordered startup steps and report failures without aborting later work."""
    failures: list[tuple[str, str]] = []
    for label, action in steps:
        try:
            action()
        except Exception as exc:
            failures.append((str(label), f"{type(exc).__name__}: {exc}"))
    return failures
