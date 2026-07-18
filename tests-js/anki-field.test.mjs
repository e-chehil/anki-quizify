import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  decodeAnkiFieldHtml,
  readAnkiFieldSource
} from "../src/shared/anki-field.js";

test("Anki HTML-source fields are decoded before Markdown analysis and preview", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  assert.equal(
    decodeAnkiFieldHtml(
      "&gt; 引用<br><br>&gt; [!NOTE]<br>&gt; 提示 &amp; 说明",
      dom.window.document
    ),
    "> 引用\n\n> [!NOTE]\n> 提示 & 说明"
  );
});

test("preprocessed fields are read as inert text without re-parsing markup", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <section id="safe"><!-- quizify-source:safe:front -->
      &lt;img src=x onerror="globalThis.compromised=true"&gt;
      **safe markdown**
    <!-- quizify-source:end:front --></section>
  </body>`);
  const field = dom.window.document.getElementById("safe");
  assert.match(readAnkiFieldSource(field, dom.window.document), /<img src=x onerror=/);
  assert.match(readAnkiFieldSource(field, dom.window.document), /\*\*safe markdown\*\*/);
  assert.equal(field.querySelector("img"), null);
  assert.equal(dom.window.compromised, undefined);
});

test("unprocessed mobile-compatible fields ignore transport comments", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <section id="legacy"><!-- quizify-source:start:front -->&gt; quote<br>next<!-- quizify-source:end:front --></section>
  </body>`);
  const field = dom.window.document.getElementById("legacy");
  assert.equal(readAnkiFieldSource(field, dom.window.document), "> quote\nnext");
});
