/* Anki editor integration, bundled by esbuild for Quizify 1.0. */
import { loadAnkiEditorAdapter } from "./anki-adapter.js";
import { createFloatingPanelManager } from "./floating-panels.js";
import {
  captureEditorSelection,
  markdownSelection,
  placeholderSelection,
  readEditorSelection,
  replaceEditorSelection,
  restoreEditorSelection
} from "./text-commands.js";
import { decodeAnkiFieldHtml } from "../shared/anki-field.js";
import { createIconElement } from "../shared/icons.js";
import { t, tn } from "../shared/i18n.js";
import {
  quizifyEditorLocale,
  quizifyNotetypeId,
  quizifyPlainTextIndices
} from "./runtime-config.js";

(() => {
  const adapter = loadAnkiEditorAdapter(globalThis);
  if (!adapter) {
    globalThis.quizifyEditorActivate = async () => {
      let notice = document.querySelector(".quizify-editor-unavailable");
      if (!notice) {
        notice = document.createElement("div");
        notice.className = "quizify-editor-unavailable";
        notice.setAttribute("lang", quizifyEditorLocale);
        notice.setAttribute("role", "alert");
        notice.textContent = t("editor.api_unavailable");
        (document.querySelector(".fields") || document.body).prepend(notice);
      }
      notice.hidden = false;
      return false;
    };
    globalThis.quizifyEditorDeactivate = async () => {
      const notice = document.querySelector(".quizify-editor-unavailable");
      if (notice) notice.hidden = true;
      return false;
    };
    return;
  }
  const {
    loaded,
    noteEditors: instances,
    plainTextLifecycle: lifecycle,
    plainTextInputs: plainTexts
  } = adapter;

  const active = () => document.body.classList.contains("quizify-editor-active");
  const syntax = globalThis.QuizifySyntax || {};
  const snippets = syntax.snippets || [];
  const markdownActions = syntax.markdownActions || [];
  const previewLimit = 80;
  const markdownButtonIcons = Object.freeze({ heading: "heading-1" });
  const snippetButtonIcons = Object.freeze([
    "fitb",
    "choice",
    "reveal",
    "annotation",
    "collapse",
    "tabs",
    "audio",
    "recite"
  ]);
  let validationTimer = null;
  let toolbarResizeObserver = null;
  let lastEditor = null;
  let lastFieldIndex = 0;
  let commandContext = null;
  let fieldNameCache = [];
  let shortcutsBound = false;
  let sessionVersion = 0;
  const managedFieldNames = new Set(["Front", "Back"]);
  const boundEditors = new WeakMap();
  const boundElements = new WeakSet();
  const floatingPanelManager = createFloatingPanelManager(globalThis, document);

  function installPlainTextPolicy() {
    if (!quizifyNotetypeId) return false;
    if (globalThis.__quizifyPlainTextPolicyState?.notetypeId === quizifyNotetypeId) {
      return false;
    }
    const setMetadata = globalThis.setNotetypeMeta;
    const setPlainTexts = globalThis.setPlainTexts;
    if (
      typeof setMetadata !== "function" ||
      typeof setPlainTexts !== "function" ||
      setPlainTexts.__quizifyPlainTextPolicy
    ) {
      return false;
    }

    let currentMetadata = null;
    let cacheGeneration = 0;
    const metadataPolicy = (metadata) => {
      currentMetadata = metadata;
      return setMetadata(metadata);
    };
    const plainTextPolicy = (values) => {
      if (String(currentMetadata?.id ?? "") !== quizifyNotetypeId) {
        return setPlainTexts(values);
      }

      const requested = Array.from(values || [], (value, index) =>
        quizifyPlainTextIndices.has(index) ? true : value
      );
      const actual = currentMetadata;
      const cacheBreaker = {
        ...actual,
        modTime: `quizify:${String(actual.modTime ?? "unknown")}:${++cacheGeneration}`
      };

      // Anki restores field visibility from a private per-notetype cache. Run
      // its normal setter with a temporary cache key before the field subtree
      // renders, then restore the real metadata. No editor is remounted later.
      setMetadata(cacheBreaker);
      try {
        return setPlainTexts(requested);
      } finally {
        setMetadata(actual);
      }
    };
    plainTextPolicy.__quizifyPlainTextPolicy = true;
    globalThis.__quizifyPlainTextPolicyState = {
      notetypeId: quizifyNotetypeId,
      plainTextIndices: quizifyPlainTextIndices
    };
    globalThis.setNotetypeMeta = metadataPolicy;
    globalThis.setPlainTexts = plainTextPolicy;
    return true;
  }

  installPlainTextPolicy();
  loaded.then(installPlainTextPolicy);

  async function noteFields() {
    const noteEditor = instances.find((instance) => instance?.fields) || instances[0];
    const noteFields = (await noteEditor?.fields) || [];
    fieldNameCache = noteFields.map((field) => field?.name || "");
    return noteFields;
  }

  function nextPaint() {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      return Promise.resolve();
    }
    return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
  }

  function setOption(name, value) {
    plainTexts.forEach((input) => setEditorOption(editorForInput(input), name, value));
  }

  function editorForInput(input) {
    return normalizeEditor(input?.codeMirror || input?.cm || input?.editor || input);
  }

  function looksLikeEditor(value) {
    return Boolean(
      value &&
        (typeof value.replaceSelection === "function" ||
          typeof value.getValue === "function" ||
          typeof value.getDoc === "function" ||
          typeof value.cm?.replaceSelection === "function" ||
          typeof value.cm?.getValue === "function" ||
          typeof value.state?.doc?.toString === "function")
    );
  }

  function codeMirrorFromNode(node) {
    return normalizeEditor(node?.CodeMirror || node?.closest?.(".CodeMirror")?.CodeMirror);
  }

  function normalizeEditor(value) {
    if (!value) return null;
    if (looksLikeEditor(value)) return value;

    const nested = [
      value.cm,
      value.editor,
      value.codeMirror,
      value.view,
      value.instance
    ];
    for (const item of nested) {
      if (looksLikeEditor(item)) return item;
    }

    const element = value.element || value.node || value.dom || value.wrapper || value.root;
    if (element?.querySelector) {
      return codeMirrorFromNode(element.querySelector(".CodeMirror")) || codeMirrorFromNode(element);
    }

    return null;
  }

  function fieldContainers() {
    return Array.from(document.querySelectorAll?.(".field-container[data-index]") || []);
  }

  function fieldContainer(index) {
    return (
      fieldContainers().find((element) => Number(element.dataset.index) === index) ||
      fieldContainers()[index] ||
      null
    );
  }

  function editorFromDom(index) {
    return codeMirrorFromNode(fieldContainer(index)?.querySelector(".CodeMirror"));
  }

  function editorForField(index) {
    return editorForInput(plainTexts[index]) || editorFromDom(index);
  }

  function domFieldName(index) {
    const container = fieldContainer(index);
    for (const selector of [".label-name", ".field-name", ".field-label", "label"]) {
      const text = container?.querySelector?.(selector)?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }

  function rawFieldName(index) {
    return domFieldName(index) || fieldNameCache[index] || "";
  }

  function fieldName(index) {
    return rawFieldName(index) || t("editor.field_index", { index: index + 1 });
  }

  function fieldDisplayName(entry) {
    if (!entry) return t("editor.field_none");
    const name = rawFieldName(entry.index);
    return name
      ? t("editor.field_named", { name })
      : t("editor.field_index", { index: entry.index + 1 });
  }

  function isManagedEntry(entry) {
    return Boolean(entry && managedFieldNames.has(rawFieldName(entry.index)));
  }

  function allFieldEditors() {
    const count = Math.max(plainTexts.length, fieldContainers().length, fieldNameCache.length);
    return Array.from({ length: count }, (_, index) => ({
      field: index + 1,
      index,
      name: fieldName(index),
      editor: editorForField(index),
      container: fieldContainer(index)
    }));
  }

  function rememberEditor(editor, index = lastFieldIndex) {
    if (Number.isInteger(index)) lastFieldIndex = index;
    if (editor) lastEditor = editor;
  }

  function rememberCommandContext(entry = null) {
    const target = entry || currentFieldEntry();
    if (!isManagedEntry(target) || !target?.editor) return null;
    rememberEditor(target.editor, target.index);
    commandContext = {
      editor: target.editor,
      index: target.index,
      selection: captureEditorSelection(target.editor)
    };
    return commandContext;
  }

  function commandEntry() {
    const context = commandContext;
    const entries = allFieldEditors();
    const entry = context
      ? entries.find(
          (item) => item.index === context.index && item.editor === context.editor
        )
      : currentFieldEntry();
    if (!isManagedEntry(entry) || !entry?.editor) return null;
    if (context?.editor === entry.editor) {
      restoreEditorSelection(entry.editor, context.selection);
    }
    rememberEditor(entry.editor, entry.index);
    return entry;
  }

  function bindCommandActivation(button, callback) {
    const preserve = () => rememberCommandContext();
    button.addEventListener("pointerdown", preserve);
    button.addEventListener("mousedown", (event) => {
      preserve();
      event.preventDefault();
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const entry = commandEntry();
      if (!entry) return;
      callback(entry);
      rememberCommandContext(entry);
    });
  }

  function bindPanelSelectionPreservation(summary) {
    const preserve = () => rememberCommandContext();
    summary.addEventListener("pointerdown", preserve);
    summary.addEventListener("mousedown", (event) => {
      preserve();
      event.preventDefault();
    });
  }

  function editorHasFocus(editor) {
    if (!editor) return false;
    if (typeof editor.hasFocus === "function") return editor.hasFocus();
    if (typeof editor.hasFocus === "boolean") return editor.hasFocus;
    if (typeof editor.cm?.hasFocus === "function") return editor.cm.hasFocus();
    if (typeof editor.getWrapperElement === "function") {
      return editor.getWrapperElement()?.contains?.(document.activeElement) || false;
    }
    return editor.dom?.contains?.(document.activeElement) || false;
  }

  function currentFieldEntry() {
    const entries = allFieldEditors();
    const focused = entries.find((entry) => editorHasFocus(entry.editor));
    if (focused?.editor) {
      rememberEditor(focused.editor, focused.index);
      return focused;
    }

    const remembered = entries.find(
      (entry) => entry.index === lastFieldIndex && (entry.editor || entry.container)
    );
    if (remembered) {
      rememberEditor(remembered.editor, remembered.index);
      return remembered;
    }

    const fromLastEditor = entries.find((entry) => entry.editor && entry.editor === lastEditor);
    if (fromLastEditor) {
      rememberEditor(fromLastEditor.editor, fromLastEditor.index);
      return fromLastEditor;
    }

    const first = entries.find((entry) => entry.editor || entry.container);
    if (first?.editor) rememberEditor(first.editor, first.index);
    return first || null;
  }

  function focusedEditor() {
    const entry = currentFieldEntry();
    if (entry?.editor) rememberEditor(entry.editor, entry.index);
    return entry?.editor || null;
  }

  function fieldEntryForTarget(target) {
    const container = target?.closest?.(".field-container[data-index]");
    if (!container) return null;
    const index = Number(container.dataset.index);
    if (!Number.isInteger(index)) return null;
    const entry = allFieldEditors().find((item) => item.index === index) || null;
    if (entry?.editor) rememberEditor(entry.editor, entry.index);
    return entry;
  }

  function focusEditor(editor) {
    if (typeof editor.focus === "function") {
      editor.focus();
    } else if (typeof editor.cm?.focus === "function") {
      editor.cm.focus();
    }
  }

  function editorValue(editor) {
    if (typeof editor?.getValue === "function") return editor.getValue();
    if (typeof editor?.getDoc === "function" && typeof editor.getDoc()?.getValue === "function") {
      return editor.getDoc().getValue();
    }
    if (typeof editor?.cm?.getValue === "function") return editor.cm.getValue();
    if (typeof editor?.state?.doc?.toString === "function") {
      return editor.state.doc.toString();
    }
    return "";
  }

  function domEditorValue(container) {
    const lines = Array.from(container?.querySelectorAll?.(".CodeMirror-code pre") || []);
    return lines
      .map((line) => line.textContent.replace(/\u200b/g, ""))
      .join("\n")
      .trimEnd();
  }

  function setEditorOption(editor, name, value) {
    if (typeof editor?.setOption === "function") return editor.setOption(name, value);
    if (typeof editor?.cm?.setOption === "function") return editor.cm.setOption(name, value);
    return undefined;
  }

  function insertSnippet(snippet, targetEntry = null, placeholder = null) {
    if (!active()) return false;
    const entry = targetEntry || currentFieldEntry();
    if (!isManagedEntry(entry)) return false;
    const editor = entry?.editor || focusedEditor();
    if (!editor) return false;
    if (!replaceEditorSelection(editor, snippet, placeholderSelection(snippet, placeholder))) return false;
    rememberEditor(editor, entry?.index ?? lastFieldIndex);
    focusEditor(editor);
    rememberCommandContext(entry);
    scheduleValidation();
    return true;
  }

  function insertMarkdownAction(action, targetEntry = null) {
    if (!active()) return false;
    const entry = targetEntry || currentFieldEntry();
    if (!isManagedEntry(entry)) return false;
    const editor = entry?.editor || focusedEditor();
    if (!editor) return false;
    const selection = readEditorSelection(editor);
    const value =
      typeof syntax.formatMarkdownAction === "function"
        ? syntax.formatMarkdownAction(action, selection)
        : `${action.prefix || ""}${selection || action.placeholder || ""}${action.suffix || ""}`;
    if (!replaceEditorSelection(editor, value, markdownSelection(action, selection, value))) return false;
    rememberEditor(editor, entry?.index ?? lastFieldIndex);
    focusEditor(editor);
    rememberCommandContext(entry);
    scheduleValidation();
    return true;
  }

  function toolbarStatus() {
    return document.querySelector(".quizify-diagnostics-status");
  }

  function icon(name, className) {
    const element = createIconElement(document, name, { className });
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  function updateDiagnosticsStatus(status, state, label) {
    const accessibleLabel = String(label || "");
    const labelNode = document.createElement("span");
    labelNode.className = "quizify-visually-hidden";
    labelNode.textContent = accessibleLabel;
    status.replaceChildren(
      icon(`status-${state}`, "quizify-command-icon quizify-status-icon"),
      labelNode
    );
    status.dataset.state = state;
    status.title = accessibleLabel;
    status.setAttribute("aria-label", accessibleLabel);
  }

  function diagnosticsList() {
    return document.querySelector(".quizify-diagnostics-list");
  }

  function previewList() {
    return document.querySelector(".quizify-preview-list");
  }

  function previewFieldLabel() {
    return document.querySelector(".quizify-preview-field");
  }

  function previewCountLabel() {
    return document.querySelector(".quizify-preview-count");
  }

  function entryValue(entry) {
    const value = entry?.editor ? editorValue(entry.editor) : domEditorValue(entry?.container);
    return decodeAnkiFieldHtml(value, document);
  }

  function updateCommandAvailability(entry) {
    const enabled = Boolean(active() && isManagedEntry(entry) && entry?.editor);
    for (const selector of [".quizify-markdown-button", ".quizify-snippet-button"]) {
      document.querySelectorAll(selector).forEach((button) => {
        button.disabled = !enabled;
        button.setAttribute("aria-disabled", String(!enabled));
      });
    }
    const hint = document.querySelector(".quizify-command-hint");
    if (hint) {
      hint.hidden = enabled;
      hint.textContent = active()
        ? t("editor.focus_managed_field")
        : t("editor.deactivated");
    }
  }

  function focusDiagnostic(entry, item) {
    const editor = entry?.editor;
    if (!editor) return;
    const line = Math.max(0, Number(item?.line || 1) - 1);
    const ch = Math.max(0, Number(item?.column || 1) - 1);
    const doc = typeof editor.getDoc === "function" ? editor.getDoc() : editor.doc;
    if (typeof editor.setCursor === "function") editor.setCursor({ line, ch });
    else if (typeof doc?.setCursor === "function") doc.setCursor({ line, ch });
    else if (typeof editor.state?.doc?.line === "function" && typeof editor.dispatch === "function") {
      const targetLine = editor.state.doc.line(
        Math.min(line + 1, editor.state.doc.lines || line + 1)
      );
      const anchor = Math.min(targetLine.to, targetLine.from + ch);
      editor.dispatch({ selection: { anchor }, scrollIntoView: true });
    }
    rememberEditor(editor, entry.index);
    focusEditor(editor);
    scheduleValidation();
  }

  function updateToolbarContext(entry) {
    const displayName = fieldDisplayName(entry);
    const toolbar = document.querySelector(".quizify-toolbar");
    if (toolbar) {
      toolbar.setAttribute("aria-label", t("editor.toolbar_aria", { field: displayName }));
    }

    const previewSummary = document.querySelector(".quizify-command-summary");
    if (previewSummary) {
      previewSummary.title = t("editor.preview_for_title", { field: displayName });
      previewSummary.setAttribute(
        "aria-label",
        t("editor.preview_for_aria", { field: displayName })
      );
    }
  }

  function updatePreviewFieldLabel(entry) {
    const previewLabel = previewFieldLabel();
    const displayName = fieldDisplayName(entry);
    if (previewLabel) previewLabel.textContent = displayName;
  }

  function validateEditors() {
    if (!active() || typeof syntax.analyzeQuizifySyntax !== "function") return;

    const status = toolbarStatus();
    const list = diagnosticsList();
    if (!status || !list) return;

    const entry = currentFieldEntry();
    updateToolbarContext(entry);
    updateCommandAvailability(entry);

    const managedEntries = allFieldEditors().filter(
      (item) => isManagedEntry(item) && (item.editor || item.container)
    );
    if (!managedEntries.length) {
      updateDiagnosticsStatus(status, "warning", t("editor.select_field"));
      list.replaceChildren();
      renderPreview([], null);
      return;
    }

    const diagnostics = managedEntries.flatMap((managedEntry) =>
      syntax.analyzeQuizifySyntax(entryValue(managedEntry)).map((item) => ({
        ...item,
        field: managedEntry.field,
        fieldName: fieldName(managedEntry.index),
        entry: managedEntry
      }))
    );
    const previewEntry = isManagedEntry(entry) ? entry : managedEntries[0];
    const value = entryValue(previewEntry);
    const preview =
      typeof syntax.collectQuizifyPreview === "function"
        ? syntax.collectQuizifyPreview(value).map((item) => ({
            ...item,
            field: previewEntry.field,
            fieldName: fieldName(previewEntry.index)
          }))
        : [];
    const summary = syntax.summarizeDiagnostics(diagnostics);

    const state = diagnostics.some((item) => item.severity === "error")
      ? "error"
      : diagnostics.length
        ? "warning"
        : "ok";
    updateDiagnosticsStatus(status, state, summary);

    list.replaceChildren();
    for (const item of diagnostics.slice(0, 8)) {
      const row = document.createElement("li");
      row.dataset.severity = item.severity;
      row.textContent = t("editor.diagnostic", {
        field: t("editor.field_named", { name: item.fieldName }),
        line: item.line,
        message: item.message
      });
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", t("editor.diagnostic_jump", {
        field: t("editor.field_named", { name: item.fieldName }),
        line: item.line,
        message: item.message
      }));
      row.addEventListener("click", () => focusDiagnostic(item.entry, item));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault?.();
        focusDiagnostic(item.entry, item);
      });
      list.appendChild(row);
    }

    if (diagnostics.length > 8) {
      const row = document.createElement("li");
      row.textContent = tn("editor.more_diagnostics", diagnostics.length - 8);
      list.appendChild(row);
    }

    renderPreview(preview, previewEntry);
  }

  function describePreview(item) {
    const meta = item.meta || {};
    if (item.kind === "fitb") return t("editor.preview_meta.fitb", { answer: meta.answer });
    if (item.kind === "single" || item.kind === "multiple") {
      return t("editor.preview_meta.choice", { options: meta.options, answers: meta.answers });
    }
    if (item.kind === "reveal") {
      return t("editor.preview_meta.reveal", { question: meta.question, answer: meta.answer });
    }
    if (item.kind === "annotation") {
      return t("editor.preview_meta.annotation", { text: meta.text, note: meta.note });
    }
    if (item.kind === "audio") return `${meta.title} -> ${meta.url}`;
    if (item.kind === "recite") {
      return t("editor.preview_meta.recite", { mask: meta.mask, mode: meta.mode });
    }
    if (item.kind === "collapse" || item.kind === "tab") return meta.title;
    return "";
  }

  function renderPreview(preview, entry) {
    const list = previewList();
    if (!list) return;

    const count = previewCountLabel();
    if (count) {
      count.textContent = preview.length
        ? tn("editor.structure_count", preview.length)
        : t("editor.no_structures");
    }
    updatePreviewFieldLabel(entry);
    list.replaceChildren();

    if (!preview.length) {
      const row = document.createElement("li");
      row.className = "quizify-preview-empty";
      row.textContent = entry
        ? t("editor.no_quizify_structures", { field: fieldDisplayName(entry) })
        : t("editor.select_field_for_structure");
      list.appendChild(row);
      return;
    }

    for (const item of preview.slice(0, previewLimit)) {
      const row = document.createElement("li");
      row.dataset.kind = item.kind;

      const kind = document.createElement("span");
      kind.className = "quizify-preview-kind";
      kind.textContent = item.title;
      row.appendChild(kind);

      const title = document.createElement("strong");
      title.textContent = t("editor.line", { line: item.line });
      row.appendChild(title);

      const detail = document.createElement("span");
      detail.className = "quizify-preview-detail";
      detail.textContent = describePreview(item);
      row.appendChild(detail);
      list.appendChild(row);
    }

    if (preview.length > previewLimit) {
      const row = document.createElement("li");
      row.className = "quizify-preview-empty";
      row.textContent = tn("editor.more_structures", preview.length - previewLimit);
      list.appendChild(row);
    }
  }

  function scheduleValidation() {
    clearTimeout(validationTimer);
    validationTimer = setTimeout(validateEditors, 120);
  }

  function bindEditor(input, index = lastFieldIndex) {
    const editor = editorForInput(input);
    bindEditorObject(editor, index);
  }

  function fieldIndexForInput(input) {
    const direct = plainTexts.indexOf(input);
    if (direct >= 0) return direct;
    const editor = editorForInput(input);
    const matched = allFieldEditors().find((entry) => entry.editor === editor);
    if (matched) return matched.index;
    const element = input?.element || input?.node || input?.dom || input?.wrapper || input?.root;
    const container = element?.closest?.(".field-container[data-index]");
    const index = Number(container?.dataset?.index);
    return Number.isInteger(index) ? index : lastFieldIndex;
  }

  function bindEditorObject(editor, index = lastFieldIndex) {
    if (!editor) return;
    const existing = boundEditors.get(editor);
    if (existing) {
      if (Number.isInteger(index)) existing.index = index;
      return;
    }
    const binding = { index: Number.isInteger(index) ? index : lastFieldIndex };
    boundEditors.set(editor, binding);

    const remember = () => {
      rememberEditor(editor, binding.index);
      const entry = allFieldEditors().find((item) => item.index === binding.index);
      if (entry) rememberCommandContext(entry);
      scheduleValidation();
    };

    if (typeof editor.on === "function") {
      editor.on("change", scheduleValidation);
      editor.on("focus", remember);
      editor.on("cursorActivity", remember);
    } else if (typeof editor.cm?.on === "function") {
      editor.cm.on("change", scheduleValidation);
      editor.cm.on("focus", remember);
      editor.cm.on("cursorActivity", remember);
    }
  }

  function bindFieldElement(container, index) {
    if (!container || boundElements.has(container)) return;
    boundElements.add(container);

    const remember = (event) => {
      const editor = editorFromDom(index) || editorForField(index);
      rememberEditor(editor, index);
      const entry = allFieldEditors().find((item) => item.index === index);
      if (entry) rememberCommandContext(entry);
      scheduleValidation();
    };

    for (const name of ["focusin", "mousedown", "keyup", "input", "paste", "cut"]) {
      container.addEventListener(name, remember, true);
    }
  }

  function bindVisibleEditors() {
    allFieldEditors().forEach((entry) => {
      bindEditorObject(entry.editor, entry.index);
      bindFieldElement(entry.container, entry.index);
      setEditorOption(entry.editor, "lineWrapping", true);
    });
  }

  function shortcutFor(index) {
    return `Ctrl+Alt+${index + 1}`;
  }

  function shortcutAriaLabel(index) {
    return `Control+Alt+${index + 1}`;
  }

  function shortcutIndexForEvent(event) {
    if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return -1;
    const key = String(event.key || "");
    const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(String(event.code || ""));
    const digit = /^[1-9]$/.test(key) ? key : codeMatch?.[1];
    if (!digit) return -1;
    const index = Number(digit) - 1;
    return index >= 0 && index < snippets.length ? index : -1;
  }

  function handleShortcut(event) {
    if (event.key === "Escape" && floatingPanelManager.closeTop(true)) {
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }
    if (!active() || event.defaultPrevented || event.isComposing) return;
    const targetEntry = fieldEntryForTarget(event.target);
    if (!isManagedEntry(targetEntry) || !targetEntry?.editor) return;

    const markdownAction = markdownActions.find((action) => {
      if (!action.key && !action.code) return false;
      const primary = event.ctrlKey || event.metaKey;
      if (!primary || event.altKey) return false;
      if (Boolean(action.shift) !== Boolean(event.shiftKey)) return false;
      if (action.code) return event.code === action.code;
      return String(event.key || "").toLowerCase() === action.key;
    });
    if (markdownAction) {
      if (!insertMarkdownAction(markdownAction, targetEntry)) return;
      event.preventDefault?.();
      event.stopPropagation?.();
      return;
    }

    const index = shortcutIndexForEvent(event);
    if (index < 0) return;
    if (!insertSnippet(snippets[index][1], targetEntry)) return;
    event.preventDefault?.();
    event.stopPropagation?.();
  }

  function bindShortcuts() {
    if (shortcutsBound) return;
    if (typeof document.addEventListener !== "function") return;
    document.addEventListener("keydown", handleShortcut, true);
    shortcutsBound = true;
  }

  function hasClassName(element, name) {
    return String(element?.className || "")
      .split(/\s+/)
      .includes(name);
  }

  function addClassName(element, name) {
    if (!element || hasClassName(element, name)) return;
    element.className = `${element.className || ""} ${name}`.trim();
  }

  function removeClassName(element, name) {
    if (!element) return;
    element.className = String(element.className || "")
      .split(/\s+/)
      .filter((item) => item && item !== name)
      .join(" ");
  }

  function nativeEditorToolbar() {
    return (
      document.querySelector(".note-editor > .editor-toolbar") ||
      document.querySelector(".editor-toolbar")
    );
  }

  function stopObservingToolbarResize() {
    toolbarResizeObserver?.disconnect?.();
    toolbarResizeObserver = null;
  }

  function observeToolbarResize(toolbar) {
    stopObservingToolbarResize();
    const ResizeObserverCtor = globalThis.ResizeObserver;
    if (!toolbar || typeof ResizeObserverCtor !== "function") return;

    const observer = new ResizeObserverCtor(() => {
      if (
        toolbarResizeObserver !== observer ||
        !active() ||
        toolbar.isConnected === false
      ) {
        return;
      }
      floatingPanelManager.update();
    });
    toolbarResizeObserver = observer;
    observer.observe(toolbar);

    const nativeToolbar = nativeEditorToolbar();
    if (nativeToolbar && nativeToolbar !== toolbar) observer.observe(nativeToolbar);
  }

  function insertAfter(reference, element) {
    if (!reference || !element) return false;
    if (typeof reference.after === "function") {
      reference.after(element);
      return true;
    }
    if (reference.parentNode?.insertBefore) {
      reference.parentNode.insertBefore(element, reference.nextSibling || null);
      return true;
    }
    return false;
  }

  function dockToolbar(toolbar) {
    const nativeToolbar = nativeEditorToolbar();
    const siblings = Array.from(nativeToolbar?.parentNode?.children || []);
    const alreadyDocked = siblings[siblings.indexOf(nativeToolbar) + 1] === toolbar;

    if (nativeToolbar?.parentNode && (alreadyDocked || insertAfter(nativeToolbar, toolbar))) {
      addClassName(toolbar, "quizify-toolbar-docked");
      toolbar.dataset.docked = "native";
      return;
    }

    removeClassName(toolbar, "quizify-toolbar-docked");
    toolbar.dataset.docked = "fields";
    const host = document.querySelector(".fields") || document.body;
    host.prepend(toolbar);
  }

  function ensureToolbar() {
    const existing = document.querySelector(".quizify-toolbar");
    if (existing) {
      existing.hidden = false;
      dockToolbar(existing);
      observeToolbarResize(existing);
      bindShortcuts();
      return;
    }

    const toolbar = document.createElement("div");
    toolbar.className = "quizify-toolbar";
    toolbar.hidden = false;
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("lang", quizifyEditorLocale);
    toolbar.setAttribute(
      "aria-label",
      t("editor.toolbar_aria", { field: t("editor.field_none") })
    );
    toolbar.setAttribute("aria-orientation", "horizontal");

    const inspector = document.createElement("details");
    inspector.className = "quizify-inspector";

    const status = document.createElement("summary");
    status.className = "quizify-tool-button quizify-diagnostics-status";
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    updateDiagnosticsStatus(status, "ok", t("syntax.summary.valid"));
    bindPanelSelectionPreservation(status);
    inspector.appendChild(status);

    const commands = document.createElement("div");
    commands.className = "quizify-command-bar";
    commands.setAttribute("aria-label", t("editor.commands_aria"));

    const commandHint = document.createElement("span");
    commandHint.className = "quizify-command-hint";
    commandHint.setAttribute("role", "status");
    commandHint.setAttribute("aria-live", "polite");
    commandHint.textContent = t("editor.focus_managed_field");
    toolbar.appendChild(commandHint);

    function createMarkdownButton(action) {
      const button = document.createElement("button");
      const shortcut = String(action.shortcut || "").trim();
      button.type = "button";
      button.className = "quizify-tool-button quizify-markdown-button";
      button.title = shortcut ? `${action.label} (${shortcut})` : action.label;
      button.dataset.action = action.id;
      button.dataset.label = action.label;
      button.disabled = true;
      button.setAttribute(
        "aria-label",
        shortcut
          ? t("editor.markdown_action_shortcut", { action: action.label, shortcut })
          : t("editor.markdown_action", { action: action.label })
      );
      if (shortcut) {
        button.setAttribute("aria-keyshortcuts", shortcut.replace("Ctrl", "Control"));
      }
      button.setAttribute("aria-disabled", "true");

      button.appendChild(
        icon(
          markdownButtonIcons[action.id] || action.id,
          "quizify-command-icon quizify-markdown-icon"
        )
      );

      bindCommandActivation(button, (entry) => insertMarkdownAction(action, entry));
      return button;
    }

    markdownActions
      .forEach((action) => commands.appendChild(createMarkdownButton(action)));

    snippets.forEach(([label, snippet, placeholder], index) => {
      const shortcut = shortcutFor(index);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quizify-tool-button quizify-snippet-button";
      button.title = `${label} (${shortcut})`;
      button.dataset.label = label;
      button.dataset.shortcut = shortcut;
      button.disabled = true;
      button.setAttribute(
        "aria-label",
        t("editor.snippet_shortcut", { label, shortcut })
      );
      button.setAttribute("aria-keyshortcuts", shortcutAriaLabel(index));
      button.setAttribute("aria-disabled", "true");

      button.appendChild(
        icon(
          snippetButtonIcons[index],
          "quizify-command-icon quizify-snippet-icon"
        )
      );

      const shortcutText = document.createElement("kbd");
      shortcutText.className = "quizify-shortcut";
      shortcutText.textContent = shortcut;
      button.appendChild(shortcutText);

      bindCommandActivation(button, (entry) =>
        insertSnippet(snippet, entry, placeholder)
      );
      commands.appendChild(button);
    });

    const previewMenu = document.createElement("details");
    previewMenu.className = "quizify-command-menu quizify-preview-menu";
    const previewSummary = document.createElement("summary");
    previewSummary.className = "quizify-tool-button quizify-command-summary";
    previewSummary.title = t("editor.interactive_preview");
    previewSummary.setAttribute("aria-label", t("editor.open_current_preview"));
    previewSummary.appendChild(
      icon("preview", "quizify-command-icon quizify-preview-icon")
    );
    bindPanelSelectionPreservation(previewSummary);
    previewMenu.appendChild(previewSummary);
    const livePreviewPanel = document.createElement("div");
    livePreviewPanel.className = "quizify-live-preview-panel";
    livePreviewPanel.setAttribute("aria-label", t("editor.current_preview_aria"));
    livePreviewPanel.dataset.loadingLabel = t("editor.preview_preparing");
    previewMenu.appendChild(livePreviewPanel);
    previewMenu.addEventListener("toggle", () => {
      if (!previewMenu.open) return;
      globalThis.quizifyLoadEditorPreview?.().catch((error) => {
        livePreviewPanel.textContent = error?.message || t("editor.preview_load_failed");
      });
    });
    floatingPanelManager.bind(previewMenu, livePreviewPanel, 860);
    commands.appendChild(inspector);
    commands.appendChild(previewMenu);
    toolbar.appendChild(commands);

    const diagnostics = document.createElement("ul");
    diagnostics.className = "quizify-diagnostics-list";

    const preview = document.createElement("section");
    preview.className = "quizify-preview";

    const previewHeader = document.createElement("div");
    previewHeader.className = "quizify-preview-header";

    const previewTitle = document.createElement("strong");
    previewTitle.textContent = t("editor.structure_preview");
    previewHeader.appendChild(previewTitle);

    const previewMeta = document.createElement("span");
    previewMeta.className = "quizify-preview-meta";

    const previewField = document.createElement("span");
    previewField.className = "quizify-preview-field";
    previewField.textContent = t("editor.field_index", { index: 1 });
    previewMeta.appendChild(previewField);

    const previewCount = document.createElement("span");
    previewCount.className = "quizify-preview-count";
    previewCount.textContent = t("editor.no_structures");
    previewMeta.appendChild(previewCount);
    previewHeader.appendChild(previewMeta);
    preview.appendChild(previewHeader);

    const previewItems = document.createElement("ol");
    previewItems.className = "quizify-preview-list";
    preview.appendChild(previewItems);

    const inspectorPanel = document.createElement("div");
    inspectorPanel.className = "quizify-inspector-panel";
    inspectorPanel.setAttribute("aria-label", t("editor.inspector_aria"));
    inspectorPanel.appendChild(diagnostics);
    inspectorPanel.appendChild(preview);
    inspector.appendChild(inspectorPanel);
    floatingPanelManager.bind(inspector, inspectorPanel, 760);

    dockToolbar(toolbar);
    observeToolbarResize(toolbar);
    bindShortcuts();
  }

  globalThis.quizifyEditorCurrentField = () => {
    if (!active()) return null;
    const entry = currentFieldEntry();
    return isManagedEntry(entry)
      ? {
          index: entry.index,
          name: fieldDisplayName(entry),
          value: entryValue(entry)
        }
      : null;
  };

  globalThis.quizifyEditorActivate = async () => {
    const version = ++sessionVersion;
    await loaded;
    if (version !== sessionVersion) return false;
    const noteFieldList = await noteFields();
    if (version !== sessionVersion) return false;
    lastEditor = null;
    lastFieldIndex = 0;
    commandContext = null;
    document.body.classList.add("quizify-editor-active");
    await nextPaint();
    if (version !== sessionVersion) return false;

    // Build the optional workbench after the native fields have had a paint.
    // The editor stays usable even if these enhancements fail to initialize.
    setOption("lineWrapping", true);
    ensureToolbar();
    plainTexts.forEach((input, index) => bindEditor(input, index));
    bindVisibleEditors();
    scheduleValidation();
    return true;
  };

  globalThis.quizifyEditorDeactivate = async () => {
    const version = ++sessionVersion;
    clearTimeout(validationTimer);
    validationTimer = null;
    stopObservingToolbarResize();
    floatingPanelManager.closeAll();
    document.body.classList.remove("quizify-editor-active");
    const toolbar = document.querySelector(".quizify-toolbar");
    if (toolbar) toolbar.hidden = true;
    updateCommandAvailability(null);
    lastEditor = null;
    lastFieldIndex = 0;
    commandContext = null;
    return true;
  };

  lifecycle.onMount((input) => {
    if (!active()) return;
    const index = fieldIndexForInput(input);
    setEditorOption(editorForInput(input), "lineWrapping", true);
    bindEditor(input, index);
    bindVisibleEditors();
    scheduleValidation();
  });
})();
