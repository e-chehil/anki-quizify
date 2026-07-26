from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable, Sequence

from .parser import ParseResult, ParsedCard, parse_document
from .service import ImportCard, ImportOutcome, import_cards, validate_cards


@dataclass(frozen=True)
class LoadedDocument:
    """One selected Markdown file and its parse result.

    File-system and decoding failures are data instead of exceptions so one bad
    selection does not prevent the remaining files from appearing in preview.
    """

    path: Path
    result: ParseResult | None = None
    load_error: str | None = None

    @property
    def has_errors(self) -> bool:
        return self.load_error is not None or bool(
            self.result is not None and self.result.has_errors
        )


def load_markdown_documents(paths: Iterable[str | Path]) -> tuple[LoadedDocument, ...]:
    """Read selected files as UTF-8 (accepting a BOM) and parse every file."""

    documents: list[LoadedDocument] = []
    for raw_path in paths:
        path = Path(raw_path)
        try:
            text = path.read_text(encoding="utf-8-sig")
            result = parse_document(text, source_name=str(path))
        except (OSError, UnicodeError) as exc:
            documents.append(
                LoadedDocument(path=path, load_error=f"无法读取文件：{exc}")
            )
        else:
            documents.append(LoadedDocument(path=path, result=result))
    return tuple(documents)


def map_import_cards(documents: Iterable[LoadedDocument]) -> tuple[ImportCard, ...]:
    """Translate parser records into the Anki-free input accepted by the service."""

    mapped: list[ImportCard] = []
    for document in documents:
        if document.result is None:
            continue
        media = document.result.config.media
        for card in document.result.cards:
            mapped.append(
                ImportCard(
                    source_path=document.path,
                    source_line=card.start_line,
                    front_line=card.front_line,
                    back_line=card.back_line,
                    front=card.front,
                    back=card.back,
                    deck=card.deck,
                    tags=card.tags,
                    draft=card.draft,
                    media_roots=media.roots,
                    local_media=media.local,
                    remote_media=media.remote,
                )
            )
    return tuple(mapped)


def parse_extra_tags(value: str) -> tuple[str, ...]:
    """Parse the dialog's whitespace/comma-separated additional tag field."""

    result: list[str] = []
    seen: set[str] = set()
    for tag in re.split(r"[\s,，]+", str(value).strip()):
        if tag and tag not in seen:
            seen.add(tag)
            result.append(tag)
    return tuple(result)


def _one_line(value: str, limit: int = 90) -> str:
    compact = re.sub(r"\s+", " ", value).strip()
    return compact if len(compact) <= limit else compact[: limit - 1] + "…"


def _deck_names(collection) -> list[str]:
    decks = getattr(collection, "decks", None)
    if decks is None:
        return []
    try:
        names = [
            str(item.name)
            for item in decks.all_names_and_ids(include_filtered=False)
        ]
    except (AttributeError, TypeError):
        try:
            names = [str(name) for name in decks.all_names()]
        except (AttributeError, TypeError):
            names = []
    return sorted(dict.fromkeys(name for name in names if name))


def _current_deck_name(collection, available: Sequence[str]) -> str:
    decks = getattr(collection, "decks", None)
    if decks is not None:
        try:
            current = decks.current()
            if isinstance(current, dict) and current.get("name"):
                name = str(current["name"])
                if name in available:
                    return name
            if getattr(current, "name", None):
                name = str(current.name)
                if name in available:
                    return name
        except (AttributeError, TypeError, KeyError):
            pass
    if "Default" in available:
        return "Default"
    return available[0] if available else "Default"


def _make_dialog_class():
    # Qt and aqt stay out of module import so parser/mapping tests remain pure.
    from aqt import mw
    from aqt.operations import CollectionOp
    from aqt.qt import (
        QComboBox,
        QDialog,
        QAbstractItemView,
        QFormLayout,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QMessageBox,
        QPlainTextEdit,
        QPushButton,
        QTableWidget,
        QTableWidgetItem,
        QVBoxLayout,
    )

    class MarkdownImportDialog(QDialog):
        def __init__(
            self,
            documents: Sequence[LoadedDocument],
            parent=None,
        ) -> None:
            super().__init__(parent or mw)
            self.documents = tuple(documents)
            self.cards = map_import_cards(self.documents)
            self._preview_rows: list[tuple[LoadedDocument, ParsedCard]] = []
            self._preflight_diagnostics = ()
            self._running = False
            self._operation = None
            self.setWindowTitle("导入 Quizify Markdown 卡片集")
            self.setMinimumSize(1060, 680)
            self._setup_ui()
            self._populate_diagnostics()
            self._populate_preview()
            self._update_import_enabled()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(18, 16, 18, 16)
            layout.setSpacing(10)

            title = QLabel("Markdown 批量导入预览")
            title.setProperty("role", "title")
            layout.addWidget(title)
            self.summary = QLabel()
            self.summary.setWordWrap(True)
            layout.addWidget(self.summary)

            form = QFormLayout()
            self.deck = QComboBox()
            self.deck.setEditable(True)
            names = _deck_names(mw.col)
            self.deck.addItems(names)
            self.deck.setCurrentText(_current_deck_name(mw.col, names))
            form.addRow("默认牌组：", self.deck)

            self.tags = QLineEdit()
            self.tags.setPlaceholderText("可选；用空格或逗号分隔")
            form.addRow("附加标签：", self.tags)

            self.duplicate_mode = QComboBox()
            self.duplicate_mode.addItem(
                "跳过完全相同的 Front + Back（推荐）", "skip"
            )
            self.duplicate_mode.addItem("全部创建", "create")
            form.addRow("重复卡片：", self.duplicate_mode)
            layout.addLayout(form)

            self.table = QTableWidget(0, 7)
            self.table.setHorizontalHeaderLabels(
                ["文件", "卡片", "牌组", "Front", "Back", "标签", "状态"]
            )
            self.table.setAlternatingRowColors(True)
            self.table.setWordWrap(False)
            self.table.setEditTriggers(
                QAbstractItemView.EditTrigger.NoEditTriggers
            )
            self.table.setSelectionBehavior(
                QAbstractItemView.SelectionBehavior.SelectRows
            )
            self.table.verticalHeader().setVisible(False)
            self.table.setColumnWidth(0, 150)
            self.table.setColumnWidth(1, 70)
            self.table.setColumnWidth(2, 170)
            self.table.setColumnWidth(3, 220)
            self.table.setColumnWidth(4, 220)
            self.table.setColumnWidth(5, 150)
            self.table.horizontalHeader().setStretchLastSection(True)
            layout.addWidget(self.table, 1)

            layout.addWidget(QLabel("错误与警告"))
            self.diagnostics = QPlainTextEdit()
            self.diagnostics.setReadOnly(True)
            self.diagnostics.setMaximumHeight(145)
            layout.addWidget(self.diagnostics)

            buttons = QHBoxLayout()
            buttons.addStretch()
            self.cancel_button = QPushButton("取消")
            self.cancel_button.clicked.connect(self.reject)
            buttons.addWidget(self.cancel_button)
            self.import_button = QPushButton("导入")
            self.import_button.setDefault(True)
            self.import_button.clicked.connect(self._start_import)
            buttons.addWidget(self.import_button)
            layout.addLayout(buttons)
            self.deck.currentTextChanged.connect(self._fallback_deck_changed)

            self.setStyleSheet(
                """
                QLabel[role="title"] { font-size: 20px; font-weight: 700; }
                QPushButton { min-height: 30px; padding: 3px 13px; }
                """
            )

        def _card_status(
            self, document: LoadedDocument, card: ParsedCard
        ) -> str:
            if card.draft:
                return "草稿（不导入）"
            assert document.result is not None
            relevant = [
                diagnostic
                for diagnostic in document.result.diagnostics
                if diagnostic.card_index in {None, card.index}
            ]
            if any(item.is_error for item in relevant):
                return "错误"
            preflight = [
                item
                for item in self._preflight_diagnostics
                if item.source_path == document.path
                and card.start_line <= item.line <= card.end_line
            ]
            if any(item.severity == "error" for item in preflight):
                return "错误"
            if relevant or preflight:
                return "警告"
            return "就绪"

        def _new_item(self, text: str, tooltip: str = ""):
            item = QTableWidgetItem(text)
            if tooltip:
                item.setToolTip(tooltip)
            return item

        def _populate_preview(self) -> None:
            self._preview_rows.clear()
            for document in self.documents:
                if document.result is not None:
                    self._preview_rows.extend(
                        (document, card) for card in document.result.cards
                    )
            self.table.setRowCount(len(self._preview_rows))
            fallback = self.deck.currentText().strip()
            for row, (document, card) in enumerate(self._preview_rows):
                values = (
                    document.path.name,
                    f"#{card.index}",
                    card.deck or fallback or "（未指定）",
                    _one_line(card.front),
                    _one_line(card.back),
                    " ".join(card.tags),
                    self._card_status(document, card),
                )
                tooltips = (
                    str(document.path),
                    f"起始行 {card.start_line}",
                    card.deck or "使用上方默认牌组",
                    card.front,
                    card.back,
                    " ".join(card.tags),
                    "",
                )
                for column, value in enumerate(values):
                    self.table.setItem(
                        row, column, self._new_item(value, tooltips[column])
                    )

        def _fallback_deck_changed(self, value: str) -> None:
            fallback = value.strip() or "（未指定）"
            for row, (_, card) in enumerate(self._preview_rows):
                if not card.deck:
                    self.table.item(row, 2).setText(fallback)
            self._update_import_enabled()

        def _populate_diagnostics(self) -> None:
            messages: list[str] = []
            error_count = 0
            warning_count = 0
            for document in self.documents:
                if document.load_error:
                    error_count += 1
                    messages.append(
                        f"[错误] {document.path.name}：{document.load_error}"
                    )
                    continue
                assert document.result is not None
                for diagnostic in document.result.diagnostics:
                    label = "错误" if diagnostic.is_error else "警告"
                    if diagnostic.is_error:
                        error_count += 1
                    else:
                        warning_count += 1
                    card = (
                        f"，卡片 #{diagnostic.card_index}"
                        if diagnostic.card_index is not None
                        else ""
                    )
                    messages.append(
                        f"[{label}] {document.path.name}:{diagnostic.line}{card}："
                        f"{diagnostic.message}"
                    )
            self._preflight_diagnostics = validate_cards(
                self.cards, self.deck.currentText().strip()
            )
            for diagnostic in self._preflight_diagnostics:
                label = "错误" if diagnostic.severity == "error" else "警告"
                if diagnostic.severity == "error":
                    error_count += 1
                else:
                    warning_count += 1
                messages.append(
                    f"[{label}] {diagnostic.source_path.name}:{diagnostic.line}："
                    f"{diagnostic.message}"
                )
            self.diagnostics.setPlainText(
                "\n".join(messages) if messages else "未发现解析错误或警告。"
            )
            drafts = sum(1 for card in self.cards if card.draft)
            self.summary.setText(
                f"已读取 {len(self.documents)} 个文件，共 {len(self.cards)} 张卡片；"
                f"草稿 {drafts} 张，错误 {error_count} 项，警告 {warning_count} 项。"
            )

        def _update_import_enabled(self) -> None:
            valid_parse = bool(self.documents) and not any(
                document.has_errors for document in self.documents
            )
            valid_preflight = not any(
                item.severity == "error"
                for item in self._preflight_diagnostics
            )
            importable = [card for card in self.cards if not card.draft]
            has_decks = bool(self.deck.currentText().strip()) or all(
                card.deck and card.deck.strip() for card in importable
            )
            self.import_button.setEnabled(
                valid_parse
                and valid_preflight
                and bool(importable)
                and has_decks
            )

        def _start_import(self) -> None:
            if self._running:
                return
            self._running = True
            self.import_button.setEnabled(False)
            self.import_button.setText("正在导入…")
            self.cancel_button.setEnabled(False)
            duplicate_mode = self.duplicate_mode.currentData() or "skip"
            fallback_deck = self.deck.currentText().strip()
            extra_tags = parse_extra_tags(self.tags.text())

            from .. import note_type_name

            try:
                target_notetype = note_type_name()
            except Exception as error:
                self._import_failed(error)
                return

            try:
                self._operation = CollectionOp(
                    parent=self,
                    op=lambda col: import_cards(
                        col,
                        notetype_name=target_notetype,
                        cards=self.cards,
                        fallback_deck=fallback_deck,
                        extra_tags=extra_tags,
                        duplicate_mode=str(duplicate_mode),
                    ),
                )
                self._operation.success(self._import_succeeded)
                self._operation.failure(self._import_failed)
                self._operation.run_in_background()
            except Exception as error:
                self._import_failed(error)

        def _import_succeeded(self, outcome: ImportOutcome) -> None:
            self._running = False
            self._operation = None
            self.cancel_button.setEnabled(True)
            details = (
                f"已创建 {outcome.created} 张卡片，"
                f"跳过重复 {outcome.skipped} 张，"
                f"忽略草稿 {outcome.drafts} 张。"
            )
            if outcome.copied_media:
                details += f"\n已复制 {len(outcome.copied_media)} 个媒体文件。"
            warnings = [
                item for item in outcome.diagnostics if item.severity != "error"
            ]
            if warnings:
                details += f"\n导入过程中另有 {len(warnings)} 项媒体警告："
                for warning in warnings[:3]:
                    details += (
                        f"\n- {warning.source_path.name}:{warning.line}："
                        f"{warning.message}"
                    )
                if len(warnings) > 3:
                    details += f"\n- 另有 {len(warnings) - 3} 项未列出"
            QMessageBox.information(self, "Quizify Markdown", details)
            self.accept()

        def _import_failed(self, error: Exception) -> None:
            self._running = False
            self._operation = None
            self.cancel_button.setEnabled(True)
            self.import_button.setText("导入")
            self._update_import_enabled()
            QMessageBox.warning(
                self,
                "Quizify Markdown",
                "导入失败；卡片写入已尽力回滚，已复制的媒体文件可能保留。"
                f"\n\n{error}",
            )

        def reject(self) -> None:
            if not self._running:
                super().reject()

        def closeEvent(self, event) -> None:
            if self._running:
                event.ignore()
            else:
                super().closeEvent(event)

    return MarkdownImportDialog


def show_import_dialog(parent=None) -> None:
    """Choose one or more Markdown files, then open the import preview."""

    from aqt import mw
    from aqt.qt import QFileDialog

    owner = parent or mw
    paths, _ = QFileDialog.getOpenFileNames(
        owner,
        "选择 Quizify Markdown 文件",
        "",
        "Markdown 文件 (*.md *.markdown);;所有文件 (*)",
    )
    if not paths:
        return
    documents = load_markdown_documents(paths)
    dialog_class = _make_dialog_class()
    dialog_class(documents, owner).exec()
