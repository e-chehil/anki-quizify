from __future__ import annotations

from dataclasses import dataclass
from html import escape
from pathlib import Path
import re
from typing import Callable, Iterable
from urllib.parse import quote, unquote, urlsplit


FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})(?:[^`~]*)$")
MATH_FENCE_RE = re.compile(r"^[ \t]*\$\$[ \t]*$")
REMOTE_SCHEMES = frozenset({"http", "https", "ftp", "data"})
MARKDOWN_ESCAPE_RE = re.compile(
    r"\\([!\"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~ ])"
)


@dataclass(frozen=True)
class MediaReference:
    kind: str
    target: str
    start: int
    end: int
    line: int


@dataclass(frozen=True)
class MediaDiagnostic:
    severity: str
    line: int
    message: str


@dataclass(frozen=True)
class ImportedMedia:
    kind: str
    filename: str


@dataclass(frozen=True)
class MediaRewriteResult:
    text: str
    copied: tuple[str, ...]
    references: tuple[ImportedMedia, ...]
    diagnostics: tuple[MediaDiagnostic, ...]

    @property
    def has_errors(self) -> bool:
        return any(item.severity == "error" for item in self.diagnostics)


def _closing_bracket(text: str, start: int, opening: str, closing: str) -> int:
    depth = 1
    index = start
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return -1


def _destination_span(line: str, start: int) -> tuple[int, int] | None:
    index = start
    while index < len(line) and line[index] in " \t":
        index += 1
    if index >= len(line):
        return None

    if line[index] == "<":
        end = index + 1
        while end < len(line):
            if line[end] == "\\":
                end += 2
                continue
            if line[end] == ">":
                return index + 1, end
            end += 1
        return None

    begin = index
    depth = 0
    while index < len(line):
        char = line[index]
        if char == "\\":
            index += 2
            continue
        if char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                break
            depth -= 1
        elif char in " \t" and depth == 0:
            break
        index += 1
    if index == begin:
        return None
    return begin, index


def _has_destination_closer(line: str, target_end: int) -> bool:
    index = target_end + (
        1 if target_end < len(line) and line[target_end] == ">" else 0
    )
    depth = 0
    quote_char: str | None = None
    while index < len(line):
        char = line[index]
        if char == "\\":
            index += 2
            continue
        if quote_char is not None:
            if char == quote_char:
                quote_char = None
        elif char in {'"', "'"}:
            quote_char = char
        elif char == "(":
            depth += 1
        elif char == ")":
            if depth == 0:
                return True
            depth -= 1
        index += 1
    return False


def _line_references(line: str, offset: int, line_number: int) -> Iterable[MediaReference]:
    index = 0
    inline_ticks = 0
    while index < len(line):
        if line[index] == "`":
            end = index
            while end < len(line) and line[end] == "`":
                end += 1
            run = end - index
            if inline_ticks == 0:
                inline_ticks = run
            elif run == inline_ticks:
                inline_ticks = 0
            index = end
            continue
        if inline_ticks:
            index += 1
            continue

        slash_count = 0
        before = index - 1
        while before >= 0 and line[before] == "\\":
            slash_count += 1
            before -= 1
        escaped = slash_count % 2 == 1
        if escaped:
            index += 1
            continue

        if line.startswith("!audio[", index):
            kind = "audio"
            label_start = index + len("!audio[")
        elif line.startswith("![", index):
            kind = "image"
            label_start = index + 2
        else:
            index += 1
            continue

        label_end = _closing_bracket(line, label_start, "[", "]")
        if label_end < 0:
            index += 1
            continue
        parenthesis = label_end + 1
        while parenthesis < len(line) and line[parenthesis] in " \t":
            parenthesis += 1
        if parenthesis >= len(line) or line[parenthesis] != "(":
            index = label_end + 1
            continue
        span = _destination_span(line, parenthesis + 1)
        if span is None:
            index = parenthesis + 1
            continue
        target_start, target_end = span
        if not _has_destination_closer(line, target_end):
            index = target_end
            continue
        yield MediaReference(
            kind=kind,
            target=line[target_start:target_end],
            start=offset + target_start,
            end=offset + target_end,
            line=line_number,
        )
        index = target_end


def _mask_html_comments(line: str, in_comment: bool) -> tuple[str, bool]:
    """Blank comments without changing offsets used by replacements."""

    masked = list(line)
    index = 0
    while index < len(line):
        if in_comment:
            closing = line.find("-->", index)
            end = len(line) if closing < 0 else closing + 3
            masked[index:end] = " " * (end - index)
            if closing < 0:
                return "".join(masked), True
            in_comment = False
            index = end
            continue
        if line[index] == "`":
            end = index
            while end < len(line) and line[end] == "`":
                end += 1
            marker = line[index:end]
            closing = line.find(marker, end)
            if closing < 0:
                break
            index = closing + len(marker)
            continue
        opening = line.find("<!--", index)
        next_tick = line.find("`", index)
        if opening < 0:
            break
        if 0 <= next_tick < opening:
            index = next_tick
            continue
        closing = line.find("-->", opening + 4)
        end = len(line) if closing < 0 else closing + 3
        masked[opening:end] = " " * (end - opening)
        if closing < 0:
            return "".join(masked), True
        index = end
    return "".join(masked), in_comment


def find_media_references(text: str) -> tuple[MediaReference, ...]:
    references: list[MediaReference] = []
    fence: tuple[str, int] | None = None
    math_block = False
    html_comment = False
    offset = 0
    for line_number, line_with_end in enumerate(text.splitlines(keepends=True), 1):
        line = line_with_end.rstrip("\r\n")
        if fence is not None:
            closing = re.fullmatch(
                rf"[ \t]{{0,3}}{re.escape(fence[0])}{{{fence[1]},}}[ \t]*",
                line,
            )
            if closing:
                fence = None
            offset += len(line_with_end)
            continue
        if math_block:
            if MATH_FENCE_RE.match(line):
                math_block = False
            offset += len(line_with_end)
            continue

        visible, html_comment = _mask_html_comments(line, html_comment)
        fence_match = FENCE_RE.match(visible)
        if fence_match:
            marker = fence_match.group(1)
            fence = (marker[0], len(marker))
            offset += len(line_with_end)
            continue
        if MATH_FENCE_RE.match(visible):
            math_block = True
            offset += len(line_with_end)
            continue
        if not visible.startswith(("    ", "\t")):
            references.extend(_line_references(visible, offset, line_number))
        offset += len(line_with_end)

    # splitlines() yields no final item for an empty final line, but references
    # cannot begin there, so no special trailing-line handling is required.
    return tuple(references)


def _is_within(path: Path, roots: Iterable[Path]) -> bool:
    for root in roots:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def _local_path(target: str, source_path: Path) -> Path | None:
    decoded = MARKDOWN_ESCAPE_RE.sub(r"\1", unquote(target))
    parsed = urlsplit(decoded)
    if parsed.scheme.lower() in REMOTE_SCHEMES or decoded.startswith("#"):
        return None
    if parsed.scheme or parsed.netloc:
        raise ValueError(f"不支持的媒体地址：{target}")
    candidate = Path(parsed.path)
    if candidate.is_absolute():
        raise ValueError(f"不允许绝对媒体路径：{target}")
    return (source_path.parent / candidate).resolve()


class MediaRewriter:
    """Copy supported local Markdown media through Anki's media manager."""

    def __init__(self, add_file: Callable[[str], str]) -> None:
        self._add_file = add_file
        self._copied_paths: dict[Path, str] = {}

    def rewrite(
        self,
        text: str,
        *,
        source_path: Path,
        roots: Iterable[str] = (),
        local_policy: str = "copy",
        remote_policy: str = "keep",
    ) -> MediaRewriteResult:
        source_path = source_path.resolve()
        allowed_roots = [source_path.parent]
        diagnostics: list[MediaDiagnostic] = []
        for configured in roots:
            raw_root = str(configured)
            try:
                configured_path = Path(raw_root)
                parsed_root = urlsplit(raw_root)
                invalid_root = bool(
                    configured_path.is_absolute()
                    or configured_path.drive
                    or parsed_root.scheme
                    or parsed_root.netloc
                )
            except (OSError, ValueError):
                invalid_root = True
                configured_path = Path(".")
            if invalid_root:
                diagnostics.append(
                    MediaDiagnostic(
                        "error",
                        1,
                        f"媒体 roots 只允许相对路径：{configured}",
                    )
                )
                continue
            try:
                resolved_root = (source_path.parent / configured_path).resolve()
            except (OSError, ValueError):
                diagnostics.append(
                    MediaDiagnostic(
                        "error",
                        1,
                        f"无效的媒体 root：{configured}",
                    )
                )
                continue
            if not _is_within(resolved_root, (source_path.parent,)):
                diagnostics.append(
                    MediaDiagnostic(
                        "error",
                        1,
                        f"媒体 root 不得超出 Markdown 所在目录：{configured}",
                    )
                )
                continue
            allowed_roots.append(resolved_root)

        replacements: list[tuple[int, int, str]] = []
        copied: list[str] = []
        imported: list[ImportedMedia] = []
        for reference in find_media_references(text):
            parsed = urlsplit(reference.target)
            is_network_path = not parsed.scheme and bool(parsed.netloc)
            if parsed.scheme.lower() in REMOTE_SCHEMES or is_network_path:
                if remote_policy == "error":
                    diagnostics.append(
                        MediaDiagnostic(
                            "error",
                            reference.line,
                            f"不允许远程{reference.kind}：{reference.target}",
                        )
                    )
                else:
                    diagnostics.append(
                        MediaDiagnostic(
                            "warning",
                            reference.line,
                            f"远程{reference.kind}保持原地址，离线时可能不可用：{reference.target}",
                        )
                    )
                continue
            try:
                path = _local_path(reference.target, source_path)
            except (OSError, ValueError) as exc:
                diagnostics.append(MediaDiagnostic("error", reference.line, str(exc)))
                continue
            if path is None:
                continue
            if not _is_within(path, allowed_roots):
                diagnostics.append(
                    MediaDiagnostic(
                        "error",
                        reference.line,
                        f"媒体路径超出允许目录：{reference.target}",
                    )
                )
                continue
            if not path.is_file():
                diagnostics.append(
                    MediaDiagnostic(
                        "error" if local_policy != "keep" else "warning",
                        reference.line,
                        f"找不到本地媒体：{reference.target}",
                    )
                )
                continue
            if local_policy == "error":
                diagnostics.append(
                    MediaDiagnostic(
                        "error",
                        reference.line,
                        f"当前配置禁止导入本地媒体：{reference.target}",
                    )
                )
                continue
            if local_policy == "keep":
                diagnostics.append(
                    MediaDiagnostic(
                        "warning",
                        reference.line,
                        f"本地路径未复制到 Anki，其他设备可能不可用：{reference.target}",
                    )
                )
                continue

            name = self._copied_paths.get(path)
            if name is None:
                name = str(self._add_file(str(path)))
                self._copied_paths[path] = name
                copied.append(name)
            replacements.append(
                (reference.start, reference.end, quote(name, safe="/"))
            )
            imported.append(ImportedMedia(reference.kind, name))

        chunks: list[str] = []
        cursor = 0
        for start, end, replacement in replacements:
            chunks.extend((text[cursor:start], replacement))
            cursor = end
        chunks.append(text[cursor:])
        rewritten = "".join(chunks)
        return MediaRewriteResult(
            text=rewritten,
            copied=tuple(copied),
            references=tuple(imported),
            diagnostics=tuple(diagnostics),
        )


def append_media_manifest(
    text: str, references: Iterable[ImportedMedia]
) -> str:
    """Add inert HTML references so Anki can track/export Markdown media."""

    unique: list[ImportedMedia] = []
    seen: set[tuple[str, str]] = set()
    for reference in references:
        key = (reference.kind, reference.filename)
        if key not in seen:
            seen.add(key)
            unique.append(reference)
    if not unique:
        return text
    lines = ["<!-- quizify-media:v1"]
    for reference in unique:
        filename = escape(reference.filename, quote=True)
        if reference.kind == "audio":
            lines.append(f'<audio src="{filename}"></audio>')
        else:
            lines.append(f'<img src="{filename}">')
    lines.append("-->")
    return f"{text.rstrip()}\n\n" + "\n".join(lines)
