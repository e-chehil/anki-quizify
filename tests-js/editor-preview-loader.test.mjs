import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("heavy editor preview stays unloaded until the render panel requests it", async () => {
  const dom = new JSDOM(`<!doctype html><html><head>
    <script src="https://anki.local/_addons/1172202975/web/editor.js"></script>
    <script src="https://anki.local/_addons/quizify_markdown/web/editor.js?v=cache-key&quizify=1&ntid=42&plain=0%2C1"></script>
  </head><body></body></html>`, { url: "https://anki.local/" });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  await import(`../src/editor/preview-loader.js?test=${Date.now()}`);
  assert.equal(document.querySelector('script[src*="editor-preview.js"]'), null);

  const loading = globalThis.quizifyLoadEditorPreview();
  const script = document.querySelector('script[src*="editor-preview.js"]');
  assert(script);
  assert.equal(
    script.src,
    "https://anki.local/_addons/quizify_markdown/web/editor-preview.js?v=cache-key&quizify=1&ntid=42&plain=0%2C1"
  );
  script.dispatchEvent(new dom.window.Event("load"));
  assert.equal(await loading, true);
});
