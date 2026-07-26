from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Callable


SUPPORTED_FORMAT = 1
ERROR = "error"
WARNING = "warning"


@dataclass(frozen=True)
class Diagnostic:
    severity: str
    code: str
    message: str
    line: int
    source_name: str = "<memory>"
    card_index: int | None = None

    @property
    def is_error(self) -> bool:
        return self.severity == ERROR


@dataclass(frozen=True)
class MediaConfig:
    local: str = "copy"
    remote: str = "keep"
    roots: tuple[str, ...] = ()


@dataclass(frozen=True)
class DocumentConfig:
    format_version: int = SUPPORTED_FORMAT
    deck: str | None = None
    tags: tuple[str, ...] = ()
    media: MediaConfig = MediaConfig()


@dataclass(frozen=True)
class CardConfig:
    deck: str | None = None
    tags: tuple[str, ...] = ()
    draft: bool = False


@dataclass(frozen=True)
class ParsedCard:
    index: int
    front: str
    back: str
    deck: str | None
    tags: tuple[str, ...]
    draft: bool
    start_line: int
    front_line: int
    separator_line: int | None
    back_line: int
    end_line: int
    config: CardConfig


@dataclass(frozen=True)
class ParseResult:
    source_name: str
    config: DocumentConfig
    cards: tuple[ParsedCard, ...]
    diagnostics: tuple[Diagnostic, ...]

    @property
    def errors(self) -> tuple[Diagnostic, ...]:
        return tuple(item for item in self.diagnostics if item.is_error)

    @property
    def warnings(self) -> tuple[Diagnostic, ...]:
        return tuple(item for item in self.diagnostics if not item.is_error)

    @property
    def has_errors(self) -> bool:
        return bool(self.errors)


@dataclass
class _CardBuilder:
    index: int
    start_line: int
    front_lines: list[tuple[int, str]]
    back_lines: list[tuple[int, str]]
    separator_line: int | None = None


@dataclass(frozen=True)
class _YamlLine:
    indent: int
    text: str
    line: int


_FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
_YAML_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$")
_QUIZIFY_HEADER_RE = re.compile(r"^quizify\s*:(.*)$")
_INTEGER_RE = re.compile(r"[-+]?\d+$")
_FLOAT_RE = re.compile(
    r"[-+]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][-+]?\d+)?$"
)


class _DiagnosticSink:
    def __init__(self, source_name: str) -> None:
        self.source_name = source_name
        self.items: list[Diagnostic] = []

    def add(
        self,
        severity: str,
        code: str,
        message: str,
        line: int,
        card_index: int | None = None,
    ) -> None:
        self.items.append(
            Diagnostic(
                severity=severity,
                code=code,
                message=message,
                line=max(1, line),
                source_name=self.source_name,
                card_index=card_index,
            )
        )


def _strip_yaml_comment(value: str) -> str:
    quote: str | None = None
    escaped = False
    for index, character in enumerate(value):
        if quote == '"':
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
        elif quote == "'":
            if character == quote:
                if index + 1 < len(value) and value[index + 1] == quote:
                    continue
                quote = None
        elif character in {'"', "'"}:
            quote = character
        elif character == "#" and (
            index == 0 or value[index - 1].isspace()
        ):
            return value[:index].rstrip()
    return value.rstrip()


def _split_inline_list(value: str) -> list[str] | None:
    parts: list[str] = []
    start = 0
    quote: str | None = None
    escaped = False
    for index, character in enumerate(value):
        if quote == '"':
            if escaped:
                escaped = False
            elif character == "\\":
                escaped = True
            elif character == quote:
                quote = None
        elif quote == "'":
            if character == quote:
                if index + 1 < len(value) and value[index + 1] == quote:
                    continue
                quote = None
        elif character in {'"', "'"}:
            quote = character
        elif character == ",":
            parts.append(value[start:index].strip())
            start = index + 1
        elif character in "[]{}":
            return None
    if quote is not None:
        return None
    parts.append(value[start:].strip())
    return parts


def _parse_yaml_scalar(
    raw: str,
    *,
    line: int,
    report: Callable[[str, str, str, int], None],
):
    value = _strip_yaml_comment(raw).strip()
    if not value:
        return ""
    if value.startswith('"'):
        try:
            parsed = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            report(ERROR, "invalid_yaml_string", "YAML 双引号字符串无效。", line)
            return None
        if not isinstance(parsed, str):
            report(ERROR, "invalid_yaml_string", "此处需要 YAML 字符串。", line)
            return None
        return parsed
    if value.startswith("'"):
        if len(value) < 2 or not value.endswith("'"):
            report(ERROR, "invalid_yaml_string", "YAML 单引号字符串未闭合。", line)
            return None
        return value[1:-1].replace("''", "'")
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"null", "~"}:
        return None
    if _INTEGER_RE.fullmatch(value):
        try:
            return int(value)
        except ValueError:
            pass
    if _FLOAT_RE.fullmatch(value):
        try:
            return float(value)
        except ValueError:
            pass
    if value.startswith("["):
        if not value.endswith("]"):
            report(ERROR, "invalid_yaml_list", "YAML 行内列表未闭合。", line)
            return None
        inner = value[1:-1].strip()
        if not inner:
            return []
        parts = _split_inline_list(inner)
        if parts is None or any(not part for part in parts):
            report(ERROR, "invalid_yaml_list", "YAML 行内列表无效。", line)
            return None
        return [
            _parse_yaml_scalar(part, line=line, report=report) for part in parts
        ]
    if value[0] in "&*!|>{" or value.endswith("}"):
        report(
            ERROR,
            "unsupported_yaml_value",
            "配置只支持简单标量、映射和列表，不支持此 YAML 高级语法。",
            line,
        )
        return None
    return value


class _SubsetYamlParser:
    """Parse the deliberately-small, data-only YAML subset used by imports."""

    def __init__(
        self,
        lines: list[tuple[int, str]],
        sink: _DiagnosticSink,
        *,
        card_index: int | None = None,
    ) -> None:
        self.sink = sink
        self.card_index = card_index
        self.lines: list[_YamlLine] = []
        self.locations: dict[tuple[str, ...], int] = {}
        for line_number, raw in lines:
            if not raw.strip() or raw.lstrip().startswith("#"):
                continue
            leading = raw[: len(raw) - len(raw.lstrip(" \t"))]
            if "\t" in leading:
                self._report(
                    ERROR,
                    "yaml_tab_indentation",
                    "YAML 配置缩进不能使用制表符。",
                    line_number,
                )
                continue
            self.lines.append(
                _YamlLine(len(leading), raw[len(leading) :], line_number)
            )

    def _report(self, severity: str, code: str, message: str, line: int) -> None:
        self.sink.add(
            severity, code, message, line, card_index=self.card_index
        )

    def parse(self) -> tuple[object, dict[tuple[str, ...], int]]:
        if not self.lines:
            return {}, self.locations
        value, position = self._parse_block(0, self.lines[0].indent, ())
        while position < len(self.lines):
            item = self.lines[position]
            self._report(
                ERROR,
                "unexpected_yaml_indentation",
                "YAML 配置缩进层级无效。",
                item.line,
            )
            position += 1
        return value, self.locations

    def _parse_block(
        self, position: int, indent: int, path: tuple[str, ...]
    ) -> tuple[object, int]:
        is_list = self.lines[position].text == "-" or self.lines[
            position
        ].text.startswith("- ")
        if is_list:
            return self._parse_list(position, indent, path)
        return self._parse_mapping(position, indent, path)

    def _parse_mapping(
        self, position: int, indent: int, path: tuple[str, ...]
    ) -> tuple[dict, int]:
        result: dict = {}
        while position < len(self.lines):
            item = self.lines[position]
            if item.indent < indent:
                break
            if item.indent > indent:
                self._report(
                    ERROR,
                    "unexpected_yaml_indentation",
                    "YAML 配置出现了意外缩进。",
                    item.line,
                )
                position += 1
                continue
            match = _YAML_KEY_RE.fullmatch(item.text)
            if not match:
                self._report(
                    ERROR,
                    "invalid_yaml_mapping",
                    "YAML 配置项必须写成 key: value。",
                    item.line,
                )
                position += 1
                continue
            key, raw_value = match.groups()
            key_path = path + (key,)
            self.locations[key_path] = item.line
            if key in result:
                self._report(
                    ERROR,
                    "duplicate_yaml_key",
                    f"YAML 配置项 {key!r} 重复。",
                    item.line,
                )
            cleaned = _strip_yaml_comment(raw_value).strip()
            position += 1
            if cleaned:
                result[key] = _parse_yaml_scalar(
                    cleaned, line=item.line, report=self._report
                )
                continue
            if position < len(self.lines) and self.lines[position].indent > indent:
                child_indent = self.lines[position].indent
                result[key], position = self._parse_block(
                    position, child_indent, key_path
                )
            else:
                result[key] = None
        return result, position

    def _parse_list(
        self, position: int, indent: int, path: tuple[str, ...]
    ) -> tuple[list, int]:
        result: list = []
        while position < len(self.lines):
            item = self.lines[position]
            if item.indent < indent:
                break
            if item.indent > indent:
                self._report(
                    ERROR,
                    "unexpected_yaml_indentation",
                    "YAML 列表出现了意外缩进。",
                    item.line,
                )
                position += 1
                continue
            if item.text == "-":
                raw_value = ""
            elif item.text.startswith("- "):
                raw_value = item.text[2:]
            else:
                break
            position += 1
            cleaned = _strip_yaml_comment(raw_value).strip()
            if cleaned:
                result.append(
                    _parse_yaml_scalar(
                        cleaned, line=item.line, report=self._report
                    )
                )
            elif position < len(self.lines) and self.lines[position].indent > indent:
                child_indent = self.lines[position].indent
                child, position = self._parse_block(
                    position, child_indent, path
                )
                result.append(child)
            else:
                self._report(
                    ERROR,
                    "empty_yaml_list_item",
                    "YAML 列表项不能为空。",
                    item.line,
                )
                result.append(None)
        return result, position


def _unique(values: tuple[str, ...] | list[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return tuple(result)


def _validate_string(
    value,
    *,
    key: str,
    line: int,
    sink: _DiagnosticSink,
    card_index: int | None,
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        sink.add(
            ERROR,
            "invalid_config_value",
            f"配置项 {key!r} 必须是非空字符串。",
            line,
            card_index,
        )
        return None
    return value.strip()


def _validate_string_list(
    value,
    *,
    key: str,
    line: int,
    sink: _DiagnosticSink,
    card_index: int | None,
    forbid_whitespace: bool = False,
) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        sink.add(
            ERROR,
            "invalid_config_value",
            f"配置项 {key!r} 必须是字符串列表。",
            line,
            card_index,
        )
        return ()
    strings: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip():
            sink.add(
                ERROR,
                "invalid_config_value",
                f"配置项 {key!r} 的每一项都必须是非空字符串。",
                line,
                card_index,
            )
            continue
        if forbid_whitespace and any(character.isspace() for character in item):
            sink.add(
                ERROR,
                "invalid_tag",
                f"配置项 {key!r} 的标签不能包含空白字符：{item!r}。",
                line,
                card_index,
            )
            continue
        strings.append(item.strip())
    return _unique(strings)


def _warn_unknown_keys(
    mapping: dict,
    allowed: set[str],
    locations: dict[tuple[str, ...], int],
    sink: _DiagnosticSink,
    *,
    fallback_line: int,
    card_index: int | None = None,
    path: tuple[str, ...] = (),
) -> None:
    for key in mapping:
        if key not in allowed:
            sink.add(
                WARNING,
                "unknown_config_key",
                f"未知配置项 {key!r} 已被忽略。",
                locations.get(path + (key,), fallback_line),
                card_index,
            )


def _document_config_from_mapping(
    mapping: object,
    locations: dict[tuple[str, ...], int],
    sink: _DiagnosticSink,
    *,
    line: int,
) -> DocumentConfig:
    if not isinstance(mapping, dict):
        sink.add(
            ERROR,
            "invalid_quizify_config",
            "quizify 配置必须是 YAML 映射。",
            line,
        )
        return DocumentConfig()
    _warn_unknown_keys(
        mapping,
        {"format", "deck", "tags", "media"},
        locations,
        sink,
        fallback_line=line,
    )
    raw_format = mapping.get("format", SUPPORTED_FORMAT)
    format_line = locations.get(("format",), line)
    if isinstance(raw_format, bool) or not isinstance(raw_format, int):
        sink.add(
            ERROR,
            "invalid_format",
            "quizify.format 必须是整数 1。",
            format_line,
        )
        format_version = SUPPORTED_FORMAT
    else:
        format_version = raw_format
        if format_version != SUPPORTED_FORMAT:
            sink.add(
                ERROR,
                "unsupported_format",
                f"不支持 Quizify Card Markdown 格式版本 {format_version}。",
                format_line,
            )
    deck = _validate_string(
        mapping.get("deck"),
        key="deck",
        line=locations.get(("deck",), line),
        sink=sink,
        card_index=None,
    )
    tags = _validate_string_list(
        mapping.get("tags"),
        key="tags",
        line=locations.get(("tags",), line),
        sink=sink,
        card_index=None,
        forbid_whitespace=True,
    )
    media = _media_config_from_mapping(
        mapping.get("media"), locations, sink, line=line
    )
    return DocumentConfig(format_version, deck, tags, media)


def _media_config_from_mapping(
    value,
    locations: dict[tuple[str, ...], int],
    sink: _DiagnosticSink,
    *,
    line: int,
) -> MediaConfig:
    if value is None:
        return MediaConfig()
    media_line = locations.get(("media",), line)
    if not isinstance(value, dict):
        sink.add(
            ERROR,
            "invalid_media_config",
            "quizify.media 必须是 YAML 映射。",
            media_line,
        )
        return MediaConfig()
    _warn_unknown_keys(
        value,
        {"local", "remote", "roots"},
        locations,
        sink,
        fallback_line=media_line,
        path=("media",),
    )
    local = _validate_string(
        value.get("local"),
        key="media.local",
        line=locations.get(("media", "local"), media_line),
        sink=sink,
        card_index=None,
    )
    remote = _validate_string(
        value.get("remote"),
        key="media.remote",
        line=locations.get(("media", "remote"), media_line),
        sink=sink,
        card_index=None,
    )
    if local is not None and local not in {"copy", "keep", "error"}:
        sink.add(
            ERROR,
            "invalid_media_mode",
            "media.local 只能是 copy、keep 或 error。",
            locations.get(("media", "local"), media_line),
        )
        local = None
    if remote is not None and remote not in {"keep", "error"}:
        sink.add(
            ERROR,
            "invalid_media_mode",
            "media.remote 只能是 keep 或 error。",
            locations.get(("media", "remote"), media_line),
        )
        remote = None
    roots = _validate_string_list(
        value.get("roots"),
        key="media.roots",
        line=locations.get(("media", "roots"), media_line),
        sink=sink,
        card_index=None,
    )
    return MediaConfig(local or "copy", remote or "keep", roots)


def _card_config_from_mapping(
    mapping: object,
    locations: dict[tuple[str, ...], int],
    sink: _DiagnosticSink,
    *,
    line: int,
    card_index: int,
) -> CardConfig:
    if not isinstance(mapping, dict):
        sink.add(
            ERROR,
            "invalid_card_config",
            "quizify-card 配置必须是 YAML 映射。",
            line,
            card_index,
        )
        return CardConfig()
    _warn_unknown_keys(
        mapping,
        {"deck", "tags", "draft"},
        locations,
        sink,
        fallback_line=line,
        card_index=card_index,
    )
    deck = _validate_string(
        mapping.get("deck"),
        key="deck",
        line=locations.get(("deck",), line),
        sink=sink,
        card_index=card_index,
    )
    tags = _validate_string_list(
        mapping.get("tags"),
        key="tags",
        line=locations.get(("tags",), line),
        sink=sink,
        card_index=card_index,
        forbid_whitespace=True,
    )
    draft = mapping.get("draft", False)
    if not isinstance(draft, bool):
        sink.add(
            ERROR,
            "invalid_config_value",
            "配置项 'draft' 必须是 true 或 false。",
            locations.get(("draft",), line),
            card_index,
        )
        draft = False
    return CardConfig(deck, tags, draft)


def _extract_front_matter(
    lines: list[str], sink: _DiagnosticSink
) -> tuple[DocumentConfig, int]:
    if not lines or lines[0].rstrip(" \t") != "---":
        return DocumentConfig(), 0
    closing = next(
        (
            index
            for index in range(1, len(lines))
            if lines[index].rstrip(" \t") == "---"
        ),
        None,
    )
    if closing is None:
        sink.add(
            ERROR,
            "unclosed_front_matter",
            "文档开头的 YAML 区域缺少结束分隔线 ---。",
            1,
        )
        return DocumentConfig(), len(lines)

    yaml_lines = lines[1:closing]
    declarations: list[tuple[int, str]] = []
    for index, raw in enumerate(yaml_lines, start=2):
        if raw.startswith((" ", "\t")):
            continue
        match = _QUIZIFY_HEADER_RE.fullmatch(raw)
        if match:
            declarations.append((index, match.group(1)))
    if not declarations:
        return DocumentConfig(), closing + 1
    if len(declarations) > 1:
        for duplicate_line, _ in declarations[1:]:
            sink.add(
                ERROR,
                "duplicate_quizify_config",
                "文档 YAML 中只能有一个 quizify 配置区域。",
                duplicate_line,
            )
    header_line, raw_inline = declarations[0]
    cleaned_inline = _strip_yaml_comment(raw_inline).strip()
    if cleaned_inline:
        sink.add(
            ERROR,
            "invalid_quizify_config",
            "quizify: 后应换行书写配置映射。",
            header_line,
        )
        return DocumentConfig(), closing + 1

    header_offset = header_line - 2
    section: list[tuple[int, str]] = []
    for offset in range(header_offset + 1, len(yaml_lines)):
        raw = yaml_lines[offset]
        line_number = offset + 2
        if raw.strip() and not raw.lstrip().startswith("#") and not raw.startswith(
            (" ", "\t")
        ):
            break
        section.append((line_number, raw))
    parser = _SubsetYamlParser(section, sink)
    mapping, locations = parser.parse()
    return (
        _document_config_from_mapping(
            mapping, locations, sink, line=header_line
        ),
        closing + 1,
    )


def _extract_card_config(
    lines: list[tuple[int, str]],
    sink: _DiagnosticSink,
    *,
    card_index: int,
    start_line: int,
) -> tuple[CardConfig, list[tuple[int, str]]]:
    first = next(
        (index for index, (_, value) in enumerate(lines) if value.strip()), None
    )
    if first is None:
        return CardConfig(), lines
    raw = lines[first][1].rstrip(" \t")
    if raw == "<!-- quizify-card -->":
        return CardConfig(), lines[:first] + lines[first + 1 :]
    if raw != "<!-- quizify-card":
        if raw.startswith("<!-- quizify-card"):
            sink.add(
                ERROR,
                "invalid_card_config_comment",
                "卡片配置注释应以独占一行的 <!-- quizify-card 开始。",
                lines[first][0],
                card_index,
            )
        return CardConfig(), lines
    closing = next(
        (
            index
            for index in range(first + 1, len(lines))
            if lines[index][1].strip() == "-->"
        ),
        None,
    )
    if closing is None:
        sink.add(
            ERROR,
            "unclosed_card_config",
            "quizify-card 配置注释缺少结束标记 -->。",
            lines[first][0],
            card_index,
        )
        return CardConfig(), lines
    parser = _SubsetYamlParser(
        lines[first + 1 : closing], sink, card_index=card_index
    )
    mapping, locations = parser.parse()
    config = _card_config_from_mapping(
        mapping,
        locations,
        sink,
        line=lines[first][0] if first < len(lines) else start_line,
        card_index=card_index,
    )
    return config, lines[:first] + lines[closing + 1 :]


def _trim_lines(lines: list[tuple[int, str]]) -> list[tuple[int, str]]:
    start = 0
    end = len(lines)
    while start < end and not lines[start][1].strip():
        start += 1
    while end > start and not lines[end - 1][1].strip():
        end -= 1
    return lines[start:end]


def _join_lines(lines: list[tuple[int, str]]) -> str:
    return "\n".join(value for _, value in lines)


def _is_fence_close(line: str, marker: str) -> bool:
    return bool(
        re.fullmatch(
            rf" {{0,3}}{re.escape(marker[0])}{{{len(marker)},}}[ \t]*", line
        )
    )


def _append_line(
    builder: _CardBuilder | None,
    preamble: list[tuple[int, str]],
    line_number: int,
    value: str,
) -> None:
    if builder is None:
        preamble.append((line_number, value))
    elif builder.separator_line is None:
        builder.front_lines.append((line_number, value))
    else:
        builder.back_lines.append((line_number, value))


def parse_document(text: str, source_name: str = "<memory>") -> ParseResult:
    """Parse a Quizify Card Markdown v1 document without importing Anki/Qt.

    Field content is normalized to ``\n`` newlines. Blank lines immediately
    next to structural delimiters/config comments are removed, while all
    internal Markdown (including ``---``) is retained verbatim.
    """
    sink = _DiagnosticSink(str(source_name))
    normalized = "" if text is None else str(text)
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    if normalized.startswith("\ufeff"):
        normalized = normalized[1:]
    lines = normalized.split("\n")
    document_config, content_start = _extract_front_matter(lines, sink)

    builders: list[_CardBuilder] = []
    current: _CardBuilder | None = None
    preamble: list[tuple[int, str]] = []
    fence_marker: str | None = None
    fence_line: int | None = None
    in_math = False
    math_line: int | None = None

    for offset in range(content_start, len(lines)):
        line_number = offset + 1
        raw = lines[offset]
        if fence_marker is not None:
            _append_line(current, preamble, line_number, raw)
            if _is_fence_close(raw, fence_marker):
                fence_marker = None
                fence_line = None
            continue
        if in_math:
            _append_line(current, preamble, line_number, raw)
            if raw.strip() == "$$":
                in_math = False
                math_line = None
            continue

        fence_match = _FENCE_OPEN_RE.fullmatch(raw)
        if fence_match:
            _append_line(current, preamble, line_number, raw)
            fence_marker = fence_match.group(1)
            fence_line = line_number
            continue
        if raw.strip() == "$$":
            _append_line(current, preamble, line_number, raw)
            in_math = True
            math_line = line_number
            continue

        marker_candidate = raw.rstrip(" \t")
        if marker_candidate in {"\\+++", "\\***"}:
            _append_line(current, preamble, line_number, raw[1:])
            continue
        if marker_candidate == "+++":
            if current is not None:
                builders.append(current)
            current = _CardBuilder(
                index=len(builders) + 1,
                start_line=line_number,
                front_lines=[],
                back_lines=[],
            )
            continue
        if marker_candidate == "***":
            if current is None:
                sink.add(
                    ERROR,
                    "unexpected_back_separator",
                    "在第一张卡片开始前发现了 ***。",
                    line_number,
                )
            elif current.separator_line is not None:
                sink.add(
                    ERROR,
                    "multiple_back_separators",
                    "一张卡片只能包含一个 Front/Back 分隔符 ***。",
                    line_number,
                    current.index,
                )
            else:
                current.separator_line = line_number
            continue
        _append_line(current, preamble, line_number, raw)

    if current is not None:
        builders.append(current)
    if fence_marker is not None:
        sink.add(
            WARNING,
            "unclosed_code_fence",
            "Markdown 代码围栏未闭合，后续分隔符会被视为代码内容。",
            fence_line or len(lines),
            current.index if current is not None else None,
        )
    if in_math:
        sink.add(
            WARNING,
            "unclosed_math_block",
            "块级公式 $$ 未闭合，后续分隔符会被视为公式内容。",
            math_line or len(lines),
            current.index if current is not None else None,
        )

    first_preamble = next(
        ((line, value) for line, value in preamble if value.strip()), None
    )
    if first_preamble is not None:
        sink.add(
            ERROR,
            "content_before_first_card",
            "YAML 区域之后的第一个非空内容必须是 +++。",
            first_preamble[0],
        )
    if not builders:
        sink.add(
            ERROR,
            "no_cards",
            "文档中没有找到以 +++ 开始的卡片。",
            min(content_start + 1, len(lines)),
        )

    cards: list[ParsedCard] = []
    for builder_position, builder in enumerate(builders):
        next_start = (
            builders[builder_position + 1].start_line
            if builder_position + 1 < len(builders)
            else len(lines) + 1
        )
        end_line = max(builder.start_line, next_start - 1)
        card_config, front_lines = _extract_card_config(
            builder.front_lines,
            sink,
            card_index=builder.index,
            start_line=builder.start_line,
        )
        trimmed_front = _trim_lines(front_lines)
        trimmed_back = _trim_lines(builder.back_lines)
        front = _join_lines(trimmed_front)
        back = _join_lines(trimmed_back)
        front_line = (
            trimmed_front[0][0] if trimmed_front else builder.start_line + 1
        )
        back_line = (
            trimmed_back[0][0]
            if trimmed_back
            else (builder.separator_line or builder.start_line) + 1
        )
        if not front and builder.separator_line is None and not back:
            sink.add(
                ERROR,
                "empty_card",
                "+++ 开始了一张空卡片。",
                builder.start_line,
                builder.index,
            )
        else:
            if not front:
                sink.add(
                    ERROR,
                    "empty_front",
                    "卡片的 Front 字段不能为空。",
                    builder.start_line,
                    builder.index,
                )
            if builder.separator_line is None:
                sink.add(
                    ERROR,
                    "missing_back_separator",
                    "卡片缺少 Front/Back 分隔符 ***。",
                    builder.start_line,
                    builder.index,
                )
            elif not back:
                sink.add(
                    WARNING,
                    "empty_back",
                    "卡片的 Back 字段为空。",
                    builder.separator_line,
                    builder.index,
                )
        cards.append(
            ParsedCard(
                index=builder.index,
                front=front,
                back=back,
                deck=card_config.deck or document_config.deck,
                tags=_unique(document_config.tags + card_config.tags),
                draft=card_config.draft,
                start_line=builder.start_line,
                front_line=front_line,
                separator_line=builder.separator_line,
                back_line=back_line,
                end_line=end_line,
                config=card_config,
            )
        )

    return ParseResult(
        source_name=str(source_name),
        config=document_config,
        cards=tuple(cards),
        diagnostics=tuple(sink.items),
    )


parse_quizify_markdown = parse_document
