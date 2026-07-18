import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/review/lifecycle.js";
import { initReveal } from "../src/review/runtime/disclosure.js";

test("runtime destroy removes listeners and permits clean reinitialization", () => {
  const dom = new JSDOM(
    '<!doctype html><body><span class="reveal">Question<span class="secret">Answer</span></span></body>',
    { url: "https://anki.local/" }
  );
  const lifecycle = createLifecycle();
  dom.window.myquizify = { _internal: { runtimeLifecycle: lifecycle } };
  const controllers = [];
  const initialize = () =>
    initReveal({
      root: dom.window,
      registerRevealController(controller) {
        controllers.push(controller);
      }
    });

  initialize();
  assert.equal(controllers.length, 1);
  lifecycle.dispose();
  const reveal = dom.window.document.querySelector(".reveal");
  assert.equal(reveal.dataset.quizifyInitialized, undefined);

  controllers.length = 0;
  initialize();
  assert.equal(controllers.length, 1);
  reveal.click();
  assert.equal(reveal.querySelector(".secret").style.display, "inline");

  lifecycle.dispose();
  dom.window.close();
});
