from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Iterable, Sequence

from .parser import ParseResult, ParsedCard, parse_document
from .service import ImportCard, ImportOutcome, import_cards, validate_cards
from ..i18n import tr, trn


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
                LoadedDocument(
                    path=path,
                    load_error=tr("import.file_read_failed", error=exc),
                )
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
            self.setWindowTitle(tr("import.window_title"))
            self.setMinimumSize(1060, 680)
            self._setup_ui()
            self._populate_diagnostics()
            self._populate_preview()
            self._update_import_enabled()

        def _setup_ui(self) -> None:
            layout = QVBoxLayout(self)
            layout.setContentsMargins(18, 16, 18, 16)
            layout.setSpacing(10)

            title = QLabel(tr("import.title"))
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
            form.addRow(tr("import.default_deck"), self.deck)

            self.tags = QLineEdit()
            self.tags.setPlaceholderText(tr("import.extra_tags_hint"))
            form.addRow(tr("import.extra_tags"), self.tags)

            self.duplicate_mode = QComboBox()
            self.duplicate_mode.addItem(
                tr("import.duplicates.skip"), "skip"
            )
            self.duplicate_mode.addItem(tr("import.duplicates.create"), "create")
            form.addRow(tr("import.duplicates"), self.duplicate_mode)
            layout.addLayout(form)

            self.table = QTableWidget(0, 7)
            self.table.setHorizontalHeaderLabels(
                [
                    tr("import.header.file"),
                    tr("import.header.card"),
                    tr("import.header.deck"),
                    tr("import.header.front"),
                    tr("import.header.back"),
                    tr("import.header.tags"),
                    tr("import.header.status"),
                ]
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

            layout.addWidget(QLabel(tr("import.errors_warnings")))
            self.diagnostics = QPlainTextEdit()
            self.diagnostics.setReadOnly(True)
            self.diagnostics.setMaximumHeight(145)
            layout.addWidget(self.diagnostics)

            buttons = QHBoxLayout()
            buttons.addStretch()
            self.cancel_button = QPushButton(tr("common.cancel"))
            self.cancel_button.clicked.connect(self.reject)
            buttons.addWidget(self.cancel_button)
            self.import_button = QPushButton(tr("common.import"))
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
                return tr("import.status.draft")
            assert document.result is not None
            relevant = [
                diagnostic
                for diagnostic in document.result.diagnostics
                if diagnostic.card_index in {None, card.index}
            ]
            if any(item.is_error for item in relevant):
                return tr("import.status.error")
            preflight = [
                item
                for item in self._preflight_diagnostics
                if item.source_path == document.path
                and card.start_line <= item.line <= card.end_line
            ]
            if any(item.severity == "error" for item in preflight):
                return tr("import.status.error")
            if relevant or preflight:
                return tr("import.status.warning")
            return tr("import.status.ready")

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
                    card.deck or fallback or tr("common.not_specified"),
                    _one_line(card.front),
                    _one_line(card.back),
                    " ".join(card.tags),
                    self._card_status(document, card),
                )
                tooltips = (
                    str(document.path),
                    tr("import.tooltip.start_line", line=card.start_line),
                    card.deck or tr("import.tooltip.default_deck"),
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
            fallback = value.strip() or tr("common.not_specified")
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
                        tr(
                            "import.diagnostic.file",
                            severity=tr("common.error"),
                            file=document.path.name,
                            message=document.load_error,
                        )
                    )
                    continue
                assert document.result is not None
                for diagnostic in document.result.diagnostics:
                    label = tr(
                        "common.error" if diagnostic.is_error else "common.warning"
                    )
                    if diagnostic.is_error:
                        error_count += 1
                    else:
                        warning_count += 1
                    key = (
                        "import.diagnostic.card"
                        if diagnostic.card_index is not None
                        else "import.diagnostic.line"
                    )
                    messages.append(
                        tr(
                            key,
                            severity=label,
                            file=document.path.name,
                            line=diagnostic.line,
                            card=diagnostic.card_index,
                            message=diagnostic.message,
                        )
                    )
            self._preflight_diagnostics = validate_cards(
                self.cards, self.deck.currentText().strip()
            )
            for diagnostic in self._preflight_diagnostics:
                label = tr(
                    "common.error"
                    if diagnostic.severity == "error"
                    else "common.warning"
                )
                if diagnostic.severity == "error":
                    error_count += 1
                else:
                    warning_count += 1
                messages.append(
                    tr(
                        "import.diagnostic.line",
                        severity=label,
                        file=diagnostic.source_path.name,
                        line=diagnostic.line,
                        message=diagnostic.message,
                    )
                )
            self.diagnostics.setPlainText(
                "\n".join(messages) if messages else tr("import.no_diagnostics")
            )
            drafts = sum(1 for card in self.cards if card.draft)
            summary_parts = (
                trn("import.summary.files", len(self.documents)),
                trn("import.summary.cards", len(self.cards)),
                trn("import.summary.drafts", drafts),
                trn("import.summary.errors", error_count),
                trn("import.summary.warnings", warning_count),
            )
            self.summary.setText(
                tr("common.clause_separator").join(summary_parts)
                + tr("common.sentence_end")
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
            self.import_button.setText(tr("import.in_progress"))
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
            details = tr("common.clause_separator").join(
                (
                    trn("import.result.created", outcome.created),
                    trn("import.result.skipped", outcome.skipped),
                    trn("import.result.drafts", outcome.drafts),
                )
            ) + tr("common.sentence_end")
            if outcome.copied_media:
                details += "\n" + trn(
                    "import.result.media", len(outcome.copied_media)
                )
            warnings = [
                item for item in outcome.diagnostics if item.severity != "error"
            ]
            if warnings:
                details += "\n" + trn(
                    "import.result.media_warnings", len(warnings)
                )
                for warning in warnings[:3]:
                    details += "\n- " + tr(
                        "import.diagnostic.line",
                        severity=tr("common.warning"),
                        file=warning.source_path.name,
                        line=warning.line,
                        message=warning.message,
                    )
                if len(warnings) > 3:
                    details += "\n- " + trn(
                        "import.result.omitted", len(warnings) - 3
                    )
            QMessageBox.information(self, "Quizify Markdown", details)
            self.accept()

        def _import_failed(self, error: Exception) -> None:
            self._running = False
            self._operation = None
            self.cancel_button.setEnabled(True)
            self.import_button.setText(tr("common.import"))
            self._update_import_enabled()
            QMessageBox.warning(
                self,
                "Quizify Markdown",
                tr("import.failed", error=error),
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
        tr("import.select_files"),
        "",
        tr("import.file_filter"),
    )
    if not paths:
        return
    documents = load_markdown_documents(paths)
    dialog_class = _make_dialog_class()
    dialog_class(documents, owner).exec()
