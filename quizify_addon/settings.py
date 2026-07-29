from __future__ import annotations

from copy import deepcopy
from html import escape

from aqt import mw
from aqt.qt import (
    QCheckBox,
    QComboBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
)

from . import (
    ADDON_DIR,
    ADDON_MODULE,
    ADDON_VERSION,
    DEVELOPER_CONTACT,
    ensure_notetype,
    get_config,
    sync_media,
)
from .configuration import (
    REVIEW_THEME_OPTIONS,
    apply_config_transaction,
    normalize_review_theme,
)
from .media import media_status
from .i18n import tr, trn


class QuizifySettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent or mw)
        self.setWindowTitle(tr("settings.window_title"))
        self.setMinimumWidth(620)
        self.setup_ui()
        self.load_config()

    @staticmethod
    def description(text: str) -> QLabel:
        label = QLabel(text)
        label.setWordWrap(True)
        label.setProperty("role", "description")
        return label

    def setup_ui(self) -> None:
        layout = QVBoxLayout(self)
        layout.setContentsMargins(22, 20, 22, 18)
        layout.setSpacing(14)

        title_row = QHBoxLayout()
        title = QLabel("Quizify Markdown")
        title.setProperty("role", "title")
        title_row.addWidget(title)
        title_row.addStretch()
        title_row.addWidget(QLabel(f"v{ADDON_VERSION}"))
        layout.addLayout(title_row)
        layout.addWidget(
            self.description(
                tr(
                    "settings.developer_support",
                    developer=escape(DEVELOPER_CONTACT),
                )
            )
        )

        options = QFrame()
        options.setProperty("role", "card")
        options_layout = QVBoxLayout(options)
        theme_row = QHBoxLayout()
        theme_row.addWidget(QLabel(tr("settings.template_theme")))
        theme_row.addStretch()
        self.theme = QComboBox()
        for identifier, label_key in REVIEW_THEME_OPTIONS:
            self.theme.addItem(tr(label_key), identifier)
        theme_row.addWidget(self.theme)
        options_layout.addLayout(theme_row)
        options_layout.addWidget(
            self.description(tr("settings.theme.description"))
        )
        self.cardless = QCheckBox(tr("settings.cardless"))
        self.floating = QCheckBox(tr("settings.floating_control"))
        self.ankidroid = QCheckBox(tr("settings.ankidroid_api"))
        options_layout.addWidget(self.cardless)
        options_layout.addWidget(self.floating)
        options_layout.addWidget(self.ankidroid)
        layout.addWidget(options)

        runtime = QFrame()
        runtime.setProperty("role", "card")
        runtime_layout = QVBoxLayout(runtime)
        runtime_layout.addWidget(QLabel(tr("settings.offline_runtime")))
        self.runtime_status = self.description("")
        self.runtime_status.setTextInteractionFlags(
            self.runtime_status.textInteractionFlags()
        )
        runtime_layout.addWidget(self.runtime_status)
        resync = QPushButton(tr("settings.verify_media"))
        resync.clicked.connect(self.resync)
        runtime_layout.addWidget(resync)
        layout.addWidget(runtime)

        layout.addStretch()
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton(tr("common.cancel"))
        cancel.clicked.connect(self.reject)
        buttons.addWidget(cancel)
        save = QPushButton(tr("settings.save"))
        save.setDefault(True)
        save.clicked.connect(self.save)
        buttons.addWidget(save)
        layout.addLayout(buttons)

        self.setStyleSheet(
            """
            QLabel[role="title"] { font-size: 22px; font-weight: 750; }
            QLabel[role="description"] { color: palette(mid); }
            QFrame[role="card"] {
                background: palette(base);
                border: 1px solid palette(midlight);
                border-radius: 10px;
                padding: 10px;
            }
            QCheckBox { min-height: 28px; }
            QComboBox { min-width: 128px; min-height: 30px; padding: 2px 8px; }
            QPushButton { min-height: 30px; padding: 3px 13px; }
            """
        )

    def load_config(self) -> None:
        config = get_config()
        theme_index = self.theme.findData(config["review"]["theme"])
        self.theme.setCurrentIndex(max(theme_index, 0))
        self.cardless.setChecked(config["review"]["cardless"])
        self.floating.setChecked(config["review"]["floating_control"])
        self.ankidroid.setChecked(config["platform"]["ankidroid_api"])
        self.update_runtime_status()

    def update_runtime_status(self) -> None:
        try:
            ready, total, missing = media_status(ADDON_DIR)
            details = trn(
                "settings.runtime.status", total, ready=ready, total=total
            )
            if missing:
                details += "\n" + tr(
                    "settings.runtime.missing", files=", ".join(missing)
                )
            self.runtime_status.setText(details)
        except Exception as exc:
            self.runtime_status.setText(
                tr("settings.runtime.read_failed", error=exc)
            )

    def resync(self) -> None:
        try:
            changed = sync_media()
            self.update_runtime_status()
            QMessageBox.information(
                self,
                "Quizify Markdown",
                trn("settings.runtime.sync_complete", len(changed)),
            )
        except Exception as exc:
            QMessageBox.warning(
                self,
                "Quizify Markdown",
                tr("settings.runtime.sync_failed", error=exc),
            )

    def save(self) -> None:
        current = get_config()
        proposed = deepcopy(current)
        proposed["review"]["theme"] = normalize_review_theme(
            self.theme.currentData()
        )
        proposed["review"]["cardless"] = self.cardless.isChecked()
        proposed["review"]["floating_control"] = self.floating.isChecked()
        proposed["platform"]["ankidroid_api"] = self.ankidroid.isChecked()
        try:
            apply_config_transaction(
                current,
                proposed,
                sync_media=sync_media,
                ensure_notetype=lambda config: ensure_notetype(
                    config, persist_config=False
                ),
                write_config=lambda config: mw.addonManager.writeConfig(
                    ADDON_MODULE, config
                ),
            )
        except Exception as exc:
            QMessageBox.warning(
                self,
                "Quizify Markdown",
                tr("settings.save_failed", error=exc),
            )
            return
        QMessageBox.information(
            self, "Quizify Markdown", tr("settings.saved")
        )
        self.accept()


def show_settings() -> None:
    QuizifySettingsDialog(mw).exec()
