import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("editor preview mirrors the configured review theme on both shadow boundaries", async () => {
  const dom = new JSDOM(`<!doctype html><html><head>
    <script src="https://anki.local/_addons/quizify_markdown/web/editor.js?quizify=1&theme=gezhi"></script>
  </head><body class="nightMode"></body></html>`, {
    url: "https://anki.local/"
  });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = dom.window.MutationObserver;

  const { syncPreviewTheme } = await import(
    `../src/editor/preview.js?theme-test=${Date.now()}`
  );
  const { normalizeReviewTheme, quizifyReviewTheme } = await import(
    "../src/editor/runtime-config.js"
  );
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "open" });
  const surface = document.createElement("article");
  surface.className = "quizify-preview-surface";
  shadow.appendChild(surface);

  assert.equal(quizifyReviewTheme, "gezhi");
  assert.equal(syncPreviewTheme(host), true);
  assert(host.classList.contains("nightMode"));
  assert.equal(host.dataset.theme, "dark");
  assert.equal(host.dataset.quizifyTheme, "gezhi");
  assert.equal(surface.dataset.quizifyTheme, "gezhi");
  assert.equal(normalizeReviewTheme("unexpected"), "kaiwu");

  document.body.classList.remove("nightMode");
  assert.equal(syncPreviewTheme(host), false);
  assert.equal(host.dataset.theme, "light");
  assert.equal(host.dataset.quizifyTheme, "gezhi");

  document.body.classList.add("night_mode");
  assert.equal(syncPreviewTheme(host), true);
  assert.equal(host.dataset.theme, "dark");
});
