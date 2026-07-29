import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("review config applies only whitelisted themes to the document and card", async () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="quizify-stage">
      <main class="container"></main>
      <aside class="container"></aside>
    </div>
  </body></html>`);
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  await import(`../src/review/orchestrator.js?theme-test=${Date.now()}`);
  const { applyConfig, normalizeReviewTheme } = globalThis.myquizify._internal;
  const containers = Array.from(document.querySelectorAll(".container"));
  const stage = document.querySelector(".quizify-stage");

  applyConfig({ review: { cardless: true, theme: "gezhi" } });
  assert.equal(document.documentElement.dataset.quizifyTheme, "gezhi");
  assert.equal(document.body.dataset.quizifyTheme, "gezhi");
  assert.equal(stage.dataset.quizifyTheme, "gezhi");
  assert(containers.every((container) => container.dataset.quizifyTheme === "gezhi"));
  assert(containers.every((container) => container.classList.contains("quizify-cardless")));

  applyConfig({ review: { cardless: false, theme: "untrusted-theme" } });
  assert.equal(document.documentElement.dataset.quizifyTheme, "kaiwu");
  assert.equal(document.body.dataset.quizifyTheme, "kaiwu");
  assert.equal(stage.dataset.quizifyTheme, "kaiwu");
  assert(containers.every((container) => container.dataset.quizifyTheme === "kaiwu"));
  assert(containers.every((container) => !container.classList.contains("quizify-cardless")));
  assert.equal(normalizeReviewTheme(undefined), "kaiwu");
  assert.equal(normalizeReviewTheme("gezhi"), "gezhi");
});
