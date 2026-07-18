import assert from "node:assert/strict";
import test from "node:test";

import { loadAnkiEditorAdapter } from "../src/editor/anki-adapter.js";

test("editor adapter exposes Anki lifecycle state without patching globals", async () => {
  const originalSetPlainTexts = () => {};
  const target = {
    setPlainTexts: originalSetPlainTexts,
    require(name) {
      if (name === "anki/ui") return { loaded: Promise.resolve() };
      if (name === "anki/NoteEditor") return { instances: [{ fields: [] }] };
      if (name === "anki/PlainTextInput") {
        return { lifecycle: { onMount() {} }, instances: [] };
      }
      throw new Error(name);
    }
  };

  const adapter = loadAnkiEditorAdapter(target);
  assert(adapter);
  assert.equal(adapter.noteEditors.length, 1);
  assert.equal(adapter.plainTextInputs.length, 0);
  assert.equal(target.setPlainTexts, originalSetPlainTexts);
  assert.equal("setPlainTexts" in adapter, false);
});

test("editor adapter returns null outside Anki", () => {
  assert.equal(loadAnkiEditorAdapter({}), null);
});
