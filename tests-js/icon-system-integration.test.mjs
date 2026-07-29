import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("runtime UI no longer uses legacy font glyphs as icons", async () => {
  const files = [
    "src/editor/legacy-editor.js",
    "src/editor/styles.css",
    "src/review/markdown/extensions.js",
    "src/review/runtime/fitb.js",
    "src/review/runtime/floating-control.js",
    "src/review/styles.css",
    "quizify_addon/templates/front.html",
    "quizify_addon/templates/back.html",
    "docs/visual-preview.html",
    "docs/workbench-preview.html",
    "docs/icon-system-preview.html"
  ];
  const forbiddenGlyphs = [
    "⛓",
    "❞",
    "◉",
    "◐",
    "▧",
    "▦",
    "※",
    "♪",
    "↯",
    "✓",
    "✕",
    "↻",
    "➽",
    "✦",
    "“"
  ];

  for (const relativePath of files) {
    const contents = await source(relativePath);
    for (const glyph of forbiddenGlyphs) {
      assert.equal(
        contents.includes(glyph),
        false,
        `${relativePath} still contains the legacy icon glyph ${glyph}`
      );
    }
  }
});

test("card templates use the vector Quizify brand mark", async () => {
  for (const relativePath of [
    "quizify_addon/templates/front.html",
    "quizify_addon/templates/back.html"
  ]) {
    const contents = await source(relativePath);
    assert.match(
      contents,
      /class="quizify-deck-mark"[^>]*>\s*<svg\b[^>]*class="quizify-brand-icon"/
    );
    assert.match(contents, /<circle\b/);
    assert.equal((contents.match(/<path\b/g) || []).length >= 2, true);
    assert.doesNotMatch(contents, />\s*Q\s*</);
    assert.doesNotMatch(contents, /<text\b/i);
  }
});

test("semantic UI glyphs are not reintroduced through CSS content", async () => {
  for (const relativePath of [
    "src/editor/styles.css",
    "src/review/styles.css"
  ]) {
    const contents = await source(relativePath);
    assert.doesNotMatch(
      contents,
      /content\s*:\s*["'](?:i|!|\?|×|✓|✕|↻|➽|✦|“)["']/
    );
  }
});
