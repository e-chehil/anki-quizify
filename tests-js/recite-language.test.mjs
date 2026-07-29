import assert from "node:assert/strict";
import test from "node:test";

import { createParserTools } from "../src/review/markdown/parsers.js";


test("memorization tokenization preserves common writing systems", () => {
  const { tokenizeReciteText } = createParserTools({});
  const source = "Это важный русский текст · Café déjà-vu Cafe\u0301 · 中文日本語かな · 한국어 · العربية";
  const tokens = tokenizeReciteText(source, "auto");
  const byText = (value) => tokens.find((token) => token.text === value);

  assert.equal(tokens.map((token) => token.text).join(""), source);
  assert.equal(byText("Это")?.hideable, false);
  assert.equal(byText("важный")?.hideable, true);
  assert.equal(byText("Café")?.hideable, true);
  assert.equal(byText("déjà-vu")?.hideable, true);
  assert.equal(byText("Cafe\u0301")?.hideable, true);
  for (const character of ["中", "文", "日", "本", "語"]) {
    assert.equal(byText(character)?.hideable, true);
  }
  assert.equal(byText("かな")?.hideable, true);
  assert.equal(byText("한국어")?.hideable, true);
  assert.equal(byText("العربية")?.hideable, true);
});
