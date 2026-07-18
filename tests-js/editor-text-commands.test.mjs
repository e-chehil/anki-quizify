import assert from "node:assert/strict";
import test from "node:test";

import {
  captureEditorSelection,
  markdownSelection,
  placeholderSelection,
  readEditorSelection,
  replaceEditorSelection,
  restoreEditorSelection
} from "../src/editor/text-commands.js";

test("editor text commands select useful placeholders after insertion", () => {
  const editor = {
    getCursor() {
      return { line: 2, ch: 5 };
    },
    replaceSelection(value) {
      this.inserted = value;
    },
    setSelection(from, to) {
      this.selection = { from, to };
    }
  };

  const snippet = "::: 标题\n内容\n:::\n";
  assert.equal(replaceEditorSelection(editor, snippet, placeholderSelection(snippet)), true);
  assert.deepEqual(editor.selection, {
    from: { line: 2, ch: 9 },
    to: { line: 2, ch: 11 }
  });

  const link = "[术语](url)";
  assert.deepEqual(markdownSelection({ id: "link" }, "术语", link), {
    start: 5,
    end: 8
  });
});

test("editor text commands support CodeMirror 6 selections", () => {
  const editor = {
    state: {
      selection: { main: { from: 3, to: 7 } },
      doc: {
        sliceString(from, to) {
          return `${from}:${to}`;
        }
      }
    },
    dispatch(transaction) {
      this.transaction = transaction;
    }
  };

  assert.equal(readEditorSelection(editor), "3:7");
  assert.equal(
    replaceEditorSelection(editor, "**文本**", { start: 2, end: 4 }),
    true
  );
  assert.deepEqual(editor.transaction.selection, { anchor: 5, head: 7 });
  assert.equal(editor.transaction.scrollIntoView, true);
});

test("editor selections can be captured before toolbar focus and restored for commands", () => {
  const editor = {
    range: {
      anchor: { line: 4, ch: 7 },
      head: { line: 4, ch: 12 }
    },
    getDoc() {
      return {
        listSelections: () => [this.range],
        setSelection: (anchor, head) => {
          this.restored = { anchor, head };
        }
      };
    }
  };

  const snapshot = captureEditorSelection(editor);
  editor.range = {
    anchor: { line: 0, ch: 0 },
    head: { line: 0, ch: 0 }
  };
  assert.equal(restoreEditorSelection(editor, snapshot), true);
  assert.deepEqual(editor.restored, {
    anchor: { line: 4, ch: 7 },
    head: { line: 4, ch: 12 }
  });
});
