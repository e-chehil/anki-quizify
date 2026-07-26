from __future__ import annotations

from dataclasses import dataclass
from html import unescape
from pathlib import Path
import re
from types import SimpleNamespace
from typing import Any, Callable, Iterable

from .media import MediaRewriter, append_media_manifest


FIELD_BREAK_RE = re.compile(r"<br\s*/?\s*>", re.IGNORECASE)
SOURCE_MARKER_RE = re.compile(r"<!--\s*quizify-source:", re.IGNORECASE)
MEDIA_MARKER_RE = re.compile(r"<!--\s*quizify-media:", re.IGNORECASE)
MEDIA_MANIFEST_BLOCK_RE = re.compile(
    r"(?:\r?\n){2}<!-- quizify-media:v1\r?\n.*?\r?\n-->\s*\Z",
    re.IGNORECASE | re.DOTALL,
)
MAX_FIELD_BYTES = 512 * 1024


@dataclass(frozen=True)
class ImportCard:
    source_path: Path
    source_line: int
    front_line: int
    back_line: int
    front: str
    back: str
    deck: str | None
    tags: tuple[str, ...] = ()
    draft: bool = False
    media_roots: tuple[str, ...] = ()
    local_media: str = "copy"
    remote_media: str = "keep"


@dataclass(frozen=True)
class ImportDiagnostic:
    severity: str
    source_path: Path
    line: int
    message: str


@dataclass
class ImportOutcome:
    changes: Any
    created: int = 0
    skipped: int = 0
    drafts: int = 0
    copied_media: tuple[str, ...] = ()
    diagnostics: tuple[ImportDiagnostic, ...] = ()


class ImportValidationError(ValueError):
    def __init__(self, diagnostics: Iterable[ImportDiagnostic]):
        self.diagnostics = tuple(diagnostics)
        super().__init__(
            "\n".join(
                f"{item.source_path.name}:{item.line}：{item.message}"
                for item in self.diagnostics
            )
        )


def _normalize_field(value: Any) -> str:
    text = "" if value is None else str(value)
    text = unescape(FIELD_BREAK_RE.sub("\n", text))
    text = MEDIA_MANIFEST_BLOCK_RE.sub("", text)
    return text


def _note_field(note: Any, name: str) -> str:
    try:
        return _normalize_field(note[name])
    except (KeyError, TypeError):
        fields = getattr(note, "fields", {})
        if isinstance(fields, dict):
            return _normalize_field(fields.get(name, ""))
        raise


def _existing_pairs(col: Any, notetype: dict) -> set[tuple[str, str]]:
    note_ids: Iterable[int]
    finder = getattr(col, "find_notes", None)
    if callable(finder):
        escaped = str(notetype.get("name", "")).replace("\\", "\\\\").replace(
            '"', '\\"'
        )
        note_ids = finder(f'note:"{escaped}"')
    else:
        db = getattr(col, "db", None)
        if db is None or not callable(getattr(db, "list", None)):
            return set()
        note_ids = db.list(
            "select id from notes where mid = ?", int(notetype.get("id", 0))
        )
    pairs = set()
    for note_id in note_ids:
        note = col.get_note(note_id)
        pairs.add((_note_field(note, "Front"), _note_field(note, "Back")))
    return pairs


def _empty_changes() -> Any:
    try:
        from anki.collection import OpChanges

        return OpChanges()
    except ImportError:
        return SimpleNamespace()


def _request_factory() -> Callable[[Any, int], Any]:
    try:
        from anki.collection import AddNoteRequest

        return lambda note, deck_id: AddNoteRequest(note, deck_id)
    except ImportError:
        return lambda note, deck_id: SimpleNamespace(note=note, deck_id=deck_id)


def _merge_tags(*groups: Iterable[str]) -> tuple[str, ...]:
    result: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for raw in group:
            tag = str(raw).strip()
            if tag and tag not in seen:
                seen.add(tag)
                result.append(tag)
    return tuple(result)


def _tag_has_whitespace(value: Any) -> bool:
    return any(character.isspace() for character in str(value).strip())


def validate_cards(
    cards: Iterable[ImportCard], fallback_deck: str
) -> tuple[ImportDiagnostic, ...]:
    """Run the file-system preflight without changing Anki's collection."""

    diagnostics: list[ImportDiagnostic] = []
    validator = MediaRewriter(lambda path: Path(path).name)
    for card in cards:
        if card.draft:
            continue
        if card.local_media not in {"copy", "keep", "error"}:
            diagnostics.append(
                ImportDiagnostic(
                    "error",
                    card.source_path,
                    card.source_line,
                    f"不支持的本地媒体策略：{card.local_media}",
                )
            )
        if card.remote_media not in {"keep", "error"}:
            diagnostics.append(
                ImportDiagnostic(
                    "error",
                    card.source_path,
                    card.source_line,
                    f"不支持的远程媒体策略：{card.remote_media}",
                )
            )
        deck = (card.deck or fallback_deck).strip()
        if not deck:
            diagnostics.append(
                ImportDiagnostic(
                    "error", card.source_path, card.source_line, "没有目标牌组"
                )
            )
        for tag in card.tags:
            if _tag_has_whitespace(tag):
                diagnostics.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        card.source_line,
                        f"标签不能包含空白：{tag}",
                    )
                )
        for field_name, value, line in (
            ("Front", card.front, card.front_line),
            ("Back", card.back, card.back_line),
        ):
            source_oversized = len(value.encode("utf-8")) > MAX_FIELD_BYTES
            if source_oversized:
                diagnostics.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        line,
                        f"{field_name} 超过 512 KiB 限制",
                    )
                )
            if SOURCE_MARKER_RE.search(value):
                diagnostics.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        line,
                        f"{field_name} 包含 Quizify 保留的 source 标记",
                    )
                )
            if MEDIA_MARKER_RE.search(value):
                diagnostics.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        line,
                        f"{field_name} 包含 Quizify 保留的 media 标记",
                    )
                )
            result = validator.rewrite(
                value,
                source_path=card.source_path,
                roots=card.media_roots,
                local_policy=card.local_media,
                remote_policy=card.remote_media,
            )
            prepared = append_media_manifest(result.text, result.references)
            if (
                not source_oversized
                and len(prepared.encode("utf-8")) > MAX_FIELD_BYTES
            ):
                diagnostics.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        line,
                        f"{field_name} 加入媒体引用后超过 512 KiB 限制",
                    )
                )
            for item in result.diagnostics:
                diagnostics.append(
                    ImportDiagnostic(
                        item.severity,
                        card.source_path,
                        line + max(item.line - 1, 0),
                        item.message,
                    )
                )
    return tuple(diagnostics)


def _validate_target_decks(col: Any, names: Iterable[str]) -> None:
    by_name = getattr(col.decks, "by_name", None)
    if not callable(by_name):
        return
    checked: set[str] = set()
    for name in names:
        parts = name.split("::")
        for length in range(1, len(parts) + 1):
            candidate = "::".join(parts[:length])
            if candidate in checked:
                continue
            checked.add(candidate)
            existing = by_name(candidate)
            if existing and existing.get("dyn"):
                raise ValueError(
                    f"目标牌组不能是筛选牌组，也不能位于其下级：{candidate}"
                )


def import_cards(
    col: Any,
    *,
    notetype_name: str,
    cards: Iterable[ImportCard],
    fallback_deck: str,
    extra_tags: Iterable[str] = (),
    duplicate_mode: str = "skip",
    request_factory: Callable[[Any, int], Any] | None = None,
) -> ImportOutcome:
    """Validate and add parsed cards with one undoable collection operation."""

    cards = tuple(cards)
    extra_tags = tuple(extra_tags)
    if duplicate_mode not in {"create", "skip"}:
        raise ValueError(f"Unsupported duplicate mode: {duplicate_mode}")
    invalid_extra_tags = [tag for tag in extra_tags if _tag_has_whitespace(tag)]
    if invalid_extra_tags:
        raise ValueError(f"附加标签不能包含空白：{invalid_extra_tags[0]}")
    diagnostics = validate_cards(cards, fallback_deck)
    errors = tuple(item for item in diagnostics if item.severity == "error")
    if errors:
        raise ImportValidationError(errors)

    notetype = col.models.by_name(notetype_name)
    if not notetype:
        raise ValueError(f"找不到笔记类型：{notetype_name}")
    field_names = {field.get("name") for field in notetype.get("flds", [])}
    if not {"Front", "Back"}.issubset(field_names):
        raise ValueError("Quizify 笔记类型缺少 Front 或 Back 字段")

    _validate_target_decks(
        col,
        (
            (card.deck or fallback_deck).strip()
            for card in cards
            if not card.draft
        ),
    )

    existing = _existing_pairs(col, notetype) if duplicate_mode == "skip" else set()
    rewriter = MediaRewriter(col.media.add_file)
    identity_rewriter = MediaRewriter(lambda path: Path(path).name)
    ready: list[tuple[ImportCard, str, str, str, tuple[str, ...]]] = []
    copied: list[str] = []
    media_diagnostics: list[ImportDiagnostic] = []
    skipped = 0
    drafts = 0
    for card in cards:
        if card.draft:
            drafts += 1
            continue
        if duplicate_mode == "skip":
            identity_front = identity_rewriter.rewrite(
                card.front,
                source_path=card.source_path,
                roots=card.media_roots,
                local_policy=card.local_media,
                remote_policy=card.remote_media,
            )
            identity_back = identity_rewriter.rewrite(
                card.back,
                source_path=card.source_path,
                roots=card.media_roots,
                local_policy=card.local_media,
                remote_policy=card.remote_media,
            )
            identity_pair = (
                _normalize_field(
                    append_media_manifest(
                        identity_front.text, identity_front.references
                    )
                ),
                _normalize_field(
                    append_media_manifest(
                        identity_back.text, identity_back.references
                    )
                ),
            )
            if identity_pair in existing:
                skipped += 1
                continue
        front = rewriter.rewrite(
            card.front,
            source_path=card.source_path,
            roots=card.media_roots,
            local_policy=card.local_media,
            remote_policy=card.remote_media,
        )
        back = rewriter.rewrite(
            card.back,
            source_path=card.source_path,
            roots=card.media_roots,
            local_policy=card.local_media,
            remote_policy=card.remote_media,
        )
        copied.extend(front.copied)
        copied.extend(back.copied)
        for base_line, result in ((card.front_line, front), (card.back_line, back)):
            for item in result.diagnostics:
                media_diagnostics.append(
                    ImportDiagnostic(
                        item.severity,
                        card.source_path,
                        base_line + max(item.line - 1, 0),
                        item.message,
                    )
                )
        runtime_errors = tuple(
            item for item in media_diagnostics if item.severity == "error"
        )
        if runtime_errors:
            raise ImportValidationError(runtime_errors)
        front_text = append_media_manifest(front.text, front.references)
        back_text = append_media_manifest(back.text, back.references)
        transformed_errors: list[ImportDiagnostic] = []
        for field_name, value, line in (
            ("Front", front_text, card.front_line),
            ("Back", back_text, card.back_line),
        ):
            if len(value.encode("utf-8")) > MAX_FIELD_BYTES:
                transformed_errors.append(
                    ImportDiagnostic(
                        "error",
                        card.source_path,
                        line,
                        f"{field_name} 加入媒体引用后超过 512 KiB 限制",
                    )
                )
        if transformed_errors:
            raise ImportValidationError(transformed_errors)
        pair = (_normalize_field(front_text), _normalize_field(back_text))
        if duplicate_mode == "skip" and pair in existing:
            skipped += 1
            continue
        existing.add(pair)
        ready.append(
            (
                card,
                front_text,
                back_text,
                (card.deck or fallback_deck).strip(),
                _merge_tags(card.tags, extra_tags),
            )
        )

    if not ready:
        return ImportOutcome(
            changes=_empty_changes(),
            skipped=skipped,
            drafts=drafts,
            copied_media=tuple(dict.fromkeys(copied)),
            diagnostics=tuple(media_diagnostics),
        )

    target = col.add_custom_undo_entry("导入 Quizify Markdown 卡片集")
    try:
        deck_ids: dict[str, int] = {}
        for _, _, _, deck_name, _ in ready:
            if deck_name not in deck_ids:
                deck_ids[deck_name] = int(
                    col.decks.add_normal_deck_with_name(deck_name).id
                )

        factory = request_factory or _request_factory()
        requests = []
        for _, front, back, deck_name, tags in ready:
            note = col.new_note(notetype)
            note["Front"] = front
            note["Back"] = back
            note.tags = list(tags)
            requests.append(factory(note, deck_ids[deck_name]))
        col.add_notes(requests)
        changes = col.merge_undo_entries(target)
    except Exception:
        try:
            col.merge_undo_entries(target)
            col.undo()
        except Exception:
            pass
        raise

    return ImportOutcome(
        changes=changes,
        created=len(ready),
        skipped=skipped,
        drafts=drafts,
        copied_media=tuple(dict.fromkeys(copied)),
        diagnostics=tuple(media_diagnostics),
    )
