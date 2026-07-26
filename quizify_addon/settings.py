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


class QuizifySettingsDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent or mw)
        self.setWindowTitle("Quizify Markdown 设置")
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
                f"开发者：{escape(DEVELOPER_CONTACT)}　·　支持 Anki 25.09+ / AnkiDroid 2.24+"
            )
        )

        options = QFrame()
        options.setProperty("role", "card")
        options_layout = QVBoxLayout(options)
        theme_row = QHBoxLayout()
        theme_row.addWidget(QLabel("模板主题"))
        theme_row.addStretch()
        self.theme = QComboBox()
        for identifier, label in REVIEW_THEME_OPTIONS:
            self.theme.addItem(label, identifier)
        theme_row.addWidget(self.theme)
        options_layout.addLayout(theme_row)
        options_layout.addWidget(
            self.description("开务：现代清晰；格致：复古书卷。")
        )
        self.cardless = QCheckBox("使用沉浸式无卡片背景")
        self.floating = QCheckBox("启用悬浮复习控制")
        self.ankidroid = QCheckBox("启用 AnkiDroid 正式 JavaScript API")
        options_layout.addWidget(self.cardless)
        options_layout.addWidget(self.floating)
        options_layout.addWidget(self.ankidroid)
        layout.addWidget(options)

        runtime = QFrame()
        runtime.setProperty("role", "card")
        runtime_layout = QVBoxLayout(runtime)
        runtime_layout.addWidget(QLabel("内置离线运行时"))
        self.runtime_status = self.description("")
        self.runtime_status.setTextInteractionFlags(
            self.runtime_status.textInteractionFlags()
        )
        runtime_layout.addWidget(self.runtime_status)
        resync = QPushButton("校验并重新同步媒体")
        resync.clicked.connect(self.resync)
        runtime_layout.addWidget(resync)
        layout.addWidget(runtime)

        layout.addStretch()
        buttons = QHBoxLayout()
        buttons.addStretch()
        cancel = QPushButton("取消")
        cancel.clicked.connect(self.reject)
        buttons.addWidget(cancel)
        save = QPushButton("保存并更新模板")
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
            details = f"已校验 {ready}/{total} 个文件"
            if missing:
                details += "；缺失或损坏：" + "、".join(missing)
            self.runtime_status.setText(details)
        except Exception as exc:
            self.runtime_status.setText(f"运行时清单读取失败：{exc}")

    def resync(self) -> None:
        try:
            changed = sync_media()
            self.update_runtime_status()
            QMessageBox.information(
                self,
                "Quizify Markdown",
                f"媒体校验完成，已同步 {len(changed)} 个文件。",
            )
        except Exception as exc:
            QMessageBox.warning(self, "Quizify Markdown", f"媒体同步失败：{exc}")

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
                f"保存失败，原配置未提交；请修复后重试：{exc}",
            )
            return
        QMessageBox.information(self, "Quizify Markdown", "设置和模板已更新。")
        self.accept()


def show_settings() -> None:
    QuizifySettingsDialog(mw).exec()
