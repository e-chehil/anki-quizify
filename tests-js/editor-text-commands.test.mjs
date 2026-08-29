import assert from "node:assert/strict";
import test from "node:test";

import {
  captureEditorSelection,
  markdownSelection,
  placeholderSelection,
  readEditorSelection,
  replaceEditorSelection,
  restoreEditorSelection,
  snippetInsertion
} from "../src/editor/text-commands.js";

test("Quizify snippets apply selected text to every primary authoring slot", () => {
  const fixtures = [
    ["{{答案}}", "答案", "{{北京}}"],
    [";;;\nA. 选项 A\nB. 选项 B\n;;;A\n", "选项 A", ";;;\nA. 北京\nB. 选项 B\n;;;A\n"],
    ["[[题干||答案]]", "题干", "[[北京||答案]]"],
    ["[内容]^(批注)^", "内容", "[北京]^(批注)^"],
    ["::: 标题\n内容\n:::\n", "标题", "::: 北京\n内容\n:::\n"],
    ["=== 标签一\n内容一\n=== 标签二\n内容二\n===\n", "标签一", "=== 北京\n内容一\n=== 标签二\n内容二\n===\n"],
    ["!audio[标题](文件名.mp3)", "标题", "!audio[北京](文件名.mp3)"],
    [":::: recite mask=40 mode=mixed\n需要背诵的内容，%%这个短语%%会作为一个整体。\n::::\n", "需要背诵的内容", ":::: recite mask=40 mode=mixed\n北京，%%这个短语%%会作为一个整体。\n::::\n"]
  ];

  for (const [template, placeholder, expected] of fixtures) {
    const insertion = snippetInsertion(template, placeholder, "北京");
    assert.equal(insertion.value, expected);
    assert.equal(
      insertion.value.slice(insertion.selection.start, insertion.selection.end),
      "北京"
    );
  }
});

test("Quizify snippets keep default placeholders without a selection and fail safe without a slot", () => {
  assert.deepEqual(snippetInsertion("{{答案}}", "答案"), {
    value: "{{答案}}",
    selection: { start: 2, end: 4 }
  });
  assert.equal(snippetInsertion("固定模板", "缺失占位符", "保留我"), null);
});

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

test("CodeMirror 5 applies a Quizify snippet around its live selection", () => {
  const editor = {
    getCursor(side) {
      assert.equal(side, "from");
      return { line: 1, ch: 3 };
    },
    getSelection() {
      return "旧版选区";
    },
    replaceSelection(value) {
      this.inserted = value;
    },
    setSelection(from, to) {
      this.selection = { from, to };
    }
  };

  const insertion = snippetInsertion(
    "{{答案}}",
    "答案",
    readEditorSelection(editor)
  );
  assert.equal(replaceEditorSelection(editor, insertion.value, insertion.selection), true);
  assert.equal(editor.inserted, "{{旧版选区}}");
  assert.deepEqual(editor.selection, {
    from: { line: 1, ch: 5 },
    to: { line: 1, ch: 9 }
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

test("CodeMirror 6 applies a Quizify snippet around its live selection", () => {
  const editor = {
    state: {
      selection: { main: { from: 4, to: 8 } },
      doc: {
        sliceString(from, to) {
          assert.deepEqual([from, to], [4, 8]);
          return "现代选区";
        }
      }
    },
    dispatch(transaction) {
      this.transaction = transaction;
    }
  };

  const insertion = snippetInsertion(
    "[[题干||答案]]",
    "题干",
    readEditorSelection(editor)
  );
  assert.equal(replaceEditorSelection(editor, insertion.value, insertion.selection), true);
  assert.deepEqual(editor.transaction.changes, {
    from: 4,
    to: 8,
    insert: "[[现代选区||答案]]"
  });
  assert.deepEqual(editor.transaction.selection, { anchor: 6, head: 10 });
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
