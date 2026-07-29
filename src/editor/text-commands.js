function offsetPosition(start, value, offset) {
  if (!start || !Number.isInteger(start.line) || !Number.isInteger(start.ch)) return null;
  const before = String(value).slice(0, Math.max(0, offset)).split("\n");
  return before.length === 1
    ? { line: start.line, ch: start.ch + before[0].length }
    : { line: start.line + before.length - 1, ch: before.at(-1).length };
}

function applyInsertedSelection(editor, start, value, selection) {
  if (!selection || !start) return;
  const from = offsetPosition(start, value, selection.start);
  const to = offsetPosition(start, value, selection.end);
  if (!from || !to) return;
  const doc = typeof editor?.getDoc === "function" ? editor.getDoc() : editor?.doc;
  if (typeof editor?.setSelection === "function") editor.setSelection(from, to);
  else if (typeof doc?.setSelection === "function") doc.setSelection(from, to);
}

function editorDocument(editor) {
  return typeof editor?.getDoc === "function" ? editor.getDoc() : editor?.doc;
}

function copyPosition(position) {
  if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.ch)) {
    return null;
  }
  return { line: position.line, ch: position.ch };
}

export function captureEditorSelection(editor) {
  if (!editor) return null;
  if (editor.cm) return captureEditorSelection(editor.cm);

  const selection = editor.state?.selection?.main;
  if (selection) {
    const anchor = Number.isInteger(selection.anchor) ? selection.anchor : selection.from;
    const head = Number.isInteger(selection.head) ? selection.head : selection.to;
    if (Number.isInteger(anchor) && Number.isInteger(head)) {
      return { kind: "offset", anchor, head };
    }
  }

  const doc = editorDocument(editor);
  const range = doc?.listSelections?.()?.[0] || editor.listSelections?.()?.[0];
  const anchor = copyPosition(range?.anchor);
  const head = copyPosition(range?.head);
  if (anchor && head) return { kind: "position", anchor, head };

  const from = copyPosition(
    editor.getCursor?.("from") || doc?.getCursor?.("from")
  );
  const to = copyPosition(editor.getCursor?.("to") || doc?.getCursor?.("to"));
  return from && to ? { kind: "position", anchor: from, head: to } : null;
}

export function restoreEditorSelection(editor, snapshot) {
  if (!editor || !snapshot) return false;
  if (editor.cm) return restoreEditorSelection(editor.cm, snapshot);

  if (snapshot.kind === "offset" && typeof editor.dispatch === "function") {
    editor.dispatch({
      selection: { anchor: snapshot.anchor, head: snapshot.head },
      scrollIntoView: true
    });
    return true;
  }

  if (snapshot.kind !== "position") return false;
  const doc = editorDocument(editor);
  if (typeof editor.setSelection === "function") {
    editor.setSelection(snapshot.anchor, snapshot.head);
    return true;
  }
  if (typeof doc?.setSelection === "function") {
    doc.setSelection(snapshot.anchor, snapshot.head);
    return true;
  }
  return false;
}

export function replaceEditorSelection(editor, value, selection = null) {
  if (!editor) return false;
  const doc = editorDocument(editor);
  const start =
    (typeof editor.getCursor === "function" && editor.getCursor("from")) ||
    (typeof doc?.getCursor === "function" && doc.getCursor("from")) ||
    null;

  if (typeof editor.replaceSelection === "function") {
    editor.replaceSelection(value);
    applyInsertedSelection(editor, start, value, selection);
    return true;
  }
  if (typeof doc?.replaceSelection === "function") {
    doc.replaceSelection(value);
    applyInsertedSelection(editor, start, value, selection);
    return true;
  }
  if (typeof editor.cm?.replaceSelection === "function") {
    return replaceEditorSelection(editor.cm, value, selection);
  }

  const currentSelection = editor.state?.selection?.main;
  if (currentSelection && typeof editor.dispatch === "function") {
    const insertedSelection = selection || { start: value.length, end: value.length };
    editor.dispatch({
      changes: {
        from: currentSelection.from,
        to: currentSelection.to,
        insert: value
      },
      selection: {
        anchor: currentSelection.from + insertedSelection.start,
        head: currentSelection.from + insertedSelection.end
      },
      scrollIntoView: true
    });
    return true;
  }
  return false;
}

export function readEditorSelection(editor) {
  if (typeof editor?.getSelection === "function") return editor.getSelection();
  const doc = editorDocument(editor);
  if (typeof doc?.getSelection === "function") return doc.getSelection();
  if (typeof editor?.cm?.getSelection === "function") return editor.cm.getSelection();
  const selection = editor?.state?.selection?.main;
  if (selection && typeof editor.state?.doc?.sliceString === "function") {
    return editor.state.doc.sliceString(selection.from, selection.to);
  }
  return "";
}

export function placeholderSelection(value, preferred = null) {
  const source = String(value || "");
  const content = preferred || [
    /\{\{([^{}\n]+)\}\}/,
    /\[\[([^|\]\n]+)\|\|/,
    /\[([^\]\n]+)\]\^\(/,
    /^:::\s+(.+)$/m,
    /^===\s+(.+)$/m,
    /!audio\[([^\]]+)\]/,
    /^::::\s+recite[^\n]*\n([^\n]+)/m
  ].map((pattern) => pattern.exec(source)?.[1]).find(Boolean);
  if (!content) return null;
  const start = source.indexOf(content);
  return start >= 0 ? { start, end: start + content.length } : null;
}

export function markdownSelection(action, selection, value) {
  const selected = String(selection || "");
  if ((action.id === "link" || action.id === "image") && selected) {
    const urlStart = value.lastIndexOf("url");
    return urlStart >= 0 ? { start: urlStart, end: urlStart + 3 } : null;
  }
  if (selected) {
    const selectedStart = value.indexOf(selected);
    return selectedStart >= 0
      ? { start: selectedStart, end: selectedStart + selected.length }
      : { start: 0, end: value.trimEnd().length };
  }
  return placeholderSelection(value, selected || action.placeholder || "");
}
