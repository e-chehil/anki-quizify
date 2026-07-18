import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/review/lifecycle.js";
import {
  initRecite,
  MAX_RECITE_TOKENS
} from "../src/review/runtime/recite.js";

function initialize(dom, lifecycle, registerRevealController = () => {}) {
  initRecite({
    root: dom.window,
    lifecycle,
    loadReciteState: () => ({}),
    saveReciteState() {},
    tokenizeReciteText: (value) =>
      Array.from(String(value), (text) => ({
        text,
        hideable: true,
        manual: false
      })),
    canReciteScrub: (pointerType, button) => pointerType !== "touch" && button === 0,
    canArmReciteTouchScrub: (pointerType) => pointerType === "touch",
    isReciteScrubMove: (dx, dy) => Math.hypot(dx, dy) >= 6,
    registerRevealController
  });
}

function dispatchPointer(target, type, properties = {}) {
  const event = new target.ownerDocument.defaultView.Event(type, {
    bubbles: true,
    cancelable: true
  });
  Object.entries(properties).forEach(([name, value]) => {
    Object.defineProperty(event, name, { configurable: true, value });
  });
  target.dispatchEvent(event);
}

test("recite caps token DOM and delegates interaction listeners", () => {
  const sourceLength = MAX_RECITE_TOKENS + 500;
  const dom = new JSDOM(
    '<!doctype html><body><section id="front" class="quizify-field">' +
      '<section class="quizify-recite" data-mask="40" data-mode="auto">' +
      `<div class="quizify-recite-content">${"中".repeat(sourceLength)}</div>` +
      '<footer class="quizify-recite-toolbar">' +
      '<input type="range" value="40"><output></output>' +
      '<button class="quizify-recite-shuffle"></button>' +
      "</footer></section></section></body>",
    { url: "https://anki.local/" }
  );
  const originalListen = dom.window.EventTarget.prototype.addEventListener;
  let tokenListeners = 0;
  let blockListeners = 0;
  dom.window.EventTarget.prototype.addEventListener = function (...args) {
    if (this.classList?.contains("quizify-recite-token")) tokenListeners += 1;
    if (this.classList?.contains("quizify-recite")) blockListeners += 1;
    return originalListen.apply(this, args);
  };

  const lifecycle = createLifecycle();
  initialize(dom, lifecycle);
  const block = dom.window.document.querySelector(".quizify-recite");
  const content = block.querySelector(".quizify-recite-content");
  assert.equal(
    block.querySelectorAll(".quizify-recite-token").length,
    MAX_RECITE_TOKENS
  );
  assert.equal(content.textContent.length, sourceLength);
  assert.equal(block.dataset.quizifyTokenCapped, "true");
  assert.equal(tokenListeners, 0);
  assert(blockListeners >= 8 && blockListeners <= 12, blockListeners);

  lifecycle.dispose();
  const secondLifecycle = createLifecycle();
  initialize(dom, secondLifecycle);
  assert.equal(
    block.querySelectorAll(".quizify-recite-token").length,
    MAX_RECITE_TOKENS
  );
  assert.equal(
    block.querySelectorAll(".quizify-recite-token .quizify-recite-token").length,
    0
  );
  const token = block.querySelector(".quizify-recite-token");
  const wasMasked = token.classList.contains("masked");
  dispatchPointer(token, "pointerdown", {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 7,
    pointerType: "mouse"
  });
  dispatchPointer(token, "pointerup", {
    button: 0,
    clientX: 10,
    clientY: 10,
    pointerId: 7,
    pointerType: "mouse"
  });
  assert.equal(token.classList.contains("masked"), !wasMasked);

  secondLifecycle.dispose();
  dom.window.EventTarget.prototype.addEventListener = originalListen;
  dom.window.close();
});
