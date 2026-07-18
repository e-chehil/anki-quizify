import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createFloatingControlRuntime } from "../src/review/runtime/floating-control.js";

function createHarness({
  isBack,
  controllers = [],
  showAnswer = async () => ({ success: true }),
  answerEase = async () => ({ success: true }),
  supports = (capability) => ["showAnswer", "answerEase"].includes(capability),
  ready = null,
  pointerEvents = true,
  platformCallTimeout = 50,
  transitionWatchdogTimeout = 50
}) {
  const dom = new JSDOM(
    '<!doctype html><body><main class="container"><div class="quizify-field"></div></main></body>',
    { pretendToBeVisual: true, url: "https://anki.local/" }
  );
  const root = dom.window;
  if (pointerEvents) {
    root.PointerEvent = root.Event;
  } else {
    Reflect.deleteProperty(root, "PointerEvent");
  }
  root.isBack = isBack;
  const calls = {
    answerEase: [],
    clearAnswers: 0,
    clearReveal: 0,
    focus: 0,
    reducedMotion: 0,
    showAnswer: 0
  };
  root.quizifyPlatform = {
    supports,
    async showAnswer() {
      calls.showAnswer += 1;
      return showAnswer();
    },
    async answerEase(ease) {
      calls.answerEase.push(ease);
      return answerEase(ease);
    }
  };
  if (ready) root.quizifyPlatform.ready = ready;

  const runtime = createFloatingControlRuntime({
    root,
    clearRevealProgress() {
      calls.clearReveal += 1;
    },
    clearUserAnswers() {
      calls.clearAnswers += 1;
    },
    loadFloatingPosition: () => null,
    saveFloatingPosition() {},
    sideRevealControllers: () => controllers,
    persistCurrentRevealProgress() {},
    prepareRevealContext() {},
    async focusRevealedController() {
      calls.focus += 1;
    },
    prefersReducedMotion() {
      calls.reducedMotion += 1;
      return true;
    },
    platformCallTimeout,
    transitionWatchdogTimeout
  });
  const control = runtime.createFloatingController({
    review: { floating_control: true }
  });
  return { calls, control, dom, root };
}

function defineEventProperties(event, properties) {
  Object.entries(properties).forEach(([name, value]) => {
    Object.defineProperty(event, name, { configurable: true, value });
  });
  return event;
}

function dispatchPointer(target, type, properties = {}) {
  const event = defineEventProperties(
    new target.ownerDocument.defaultView.Event(type, {
      bubbles: true,
      cancelable: true
    }),
    {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      pointerType: "touch",
      ...properties
    }
  );
  target.dispatchEvent(event);
  return event;
}

function dispatchTouch(target, type, properties = {}) {
  const root = target.ownerDocument.defaultView;
  const touch = {
    clientX: 0,
    clientY: 0,
    identifier: 1,
    target,
    ...properties
  };
  const ended = type === "touchend" || type === "touchcancel";
  const event = defineEventProperties(
    new root.Event(type, { bubbles: true, cancelable: true }),
    {
      changedTouches: [touch],
      targetTouches: ended ? [] : [touch],
      touches: ended ? [] : [touch]
    }
  );
  target.dispatchEvent(event);
  return event;
}

function dispatchClick(target, properties = {}) {
  const root = target.ownerDocument.defaultView;
  const event = new root.MouseEvent("click", {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    ...properties
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchMouse(target, type, properties = {}) {
  const root = target.ownerDocument.defaultView;
  const event = new root.MouseEvent(type, {
    bubbles: true,
    button: 0,
    cancelable: true,
    clientX: 0,
    clientY: 0,
    ...properties
  });
  target.dispatchEvent(event);
  return event;
}

async function settle(root) {
  await Promise.resolve();
  await new Promise((resolve) => root.setTimeout(resolve, 0));
  await Promise.resolve();
}

function disposeHarness(harness) {
  harness.control.destroy();
  harness.dom.window.close();
}

test("floating control reveals the final item and schedules the answer side", async () => {
  let revealed = false;
  const element = { isConnected: true };
  const controller = {
    element,
    isRevealed: () => revealed,
    reveal() {
      revealed = true;
    }
  };
  const harness = createHarness({ isBack: false, controllers: [controller] });

  await harness.control.revealNext();
  await new Promise((resolve) => harness.root.setTimeout(resolve, 5));

  assert.equal(revealed, true);
  assert.equal(harness.calls.focus, 1);
  assert.equal(harness.calls.reducedMotion, 1);
  assert.equal(harness.calls.showAnswer, 1);
  harness.control.destroy();
  harness.dom.window.close();
});

test("floating control clears answer and reveal state after a confirmed ease", async () => {
  const harness = createHarness({ isBack: true });

  await harness.control.submitEase("right");

  assert.deepEqual(harness.calls.answerEase, [3]);
  assert.equal(harness.calls.clearAnswers, 1);
  assert.equal(harness.calls.clearReveal, 1);
  assert.equal(harness.calls.reducedMotion, 0);
  harness.control.destroy();
  harness.dom.window.close();
});

test("floating control preserves answer state when ease submission fails", async () => {
  const harness = createHarness({
    isBack: true,
    answerEase: async () => ({ success: false, reason: "no_bridge" })
  });

  await harness.control.submitEase("right");

  assert.deepEqual(harness.calls.answerEase, [3]);
  assert.equal(harness.calls.clearAnswers, 0);
  assert.equal(harness.calls.clearReveal, 0);
  assert.equal(
    harness.control.element.querySelector(".quizify-orb").disabled,
    false
  );
  harness.control.destroy();
  harness.dom.window.close();
});

test("floating control recovers when the platform call fails or hangs", async () => {
  for (const showAnswer of [
    async () => ({ success: false, reason: "missing_bridge" }),
    async () => ({ success: "yes" }),
    () => new Promise(() => {})
  ]) {
    const harness = createHarness({
      isBack: false,
      showAnswer,
      platformCallTimeout: 5,
      transitionWatchdogTimeout: 5
    });
    await harness.control.revealNext();
    const button = harness.control.element.querySelector(".quizify-orb");
    assert.equal(button.disabled, false);
    assert.match(
      harness.control.element.querySelector(".quizify-orb-status").textContent,
      /失败/
    );
    harness.control.destroy();
    harness.dom.window.close();
  }
});

test("floating control watchdog unlocks after a false-success transition", async () => {
  const harness = createHarness({
    isBack: false,
    showAnswer: async () => ({ success: true }),
    transitionWatchdogTimeout: 5
  });
  await harness.control.revealNext();
  const button = harness.control.element.querySelector(".quizify-orb");
  assert.equal(button.disabled, true);
  await new Promise((resolve) => harness.root.setTimeout(resolve, 10));
  assert.equal(button.disabled, false);
  assert.match(
    harness.control.element.querySelector(".quizify-orb-status").textContent,
    /未切换/
  );
  harness.control.destroy();
  harness.dom.window.close();
});

test("floating control refreshes capability UI after the platform handshake", async () => {
  let verified = false;
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = () => {
      verified = true;
      resolve();
    };
  });
  const harness = createHarness({
    isBack: true,
    supports: () => verified,
    ready: () => readyPromise
  });

  assert.equal(harness.control.element.dataset.ratingSupported, "false");
  resolveReady();
  await readyPromise;
  await new Promise((resolve) => harness.root.setTimeout(resolve, 0));
  assert.equal(harness.control.element.dataset.ratingSupported, "true");
  harness.control.destroy();
  harness.dom.window.close();
});

test("pointer tap flips the card despite minor finger jitter", async () => {
  const harness = createHarness({ isBack: false });
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchPointer(button, "pointerdown", {
    clientX: 80,
    clientY: 120,
    pointerId: 7
  });
  dispatchPointer(button, "pointermove", {
    clientX: 84,
    clientY: 123,
    pointerId: 7
  });
  dispatchPointer(button, "pointerup", {
    clientX: 84,
    clientY: 123,
    pointerId: 7
  });
  await settle(harness.root);

  assert.equal(harness.calls.showAnswer, 1);
  // A duplicated terminal event from an embedded WebView must be harmless.
  dispatchPointer(button, "pointerup", {
    clientX: 84,
    clientY: 123,
    pointerId: 7
  });
  await settle(harness.root);
  assert.equal(harness.calls.showAnswer, 1);
  disposeHarness(harness);
});

test("pointer swipes map all four rating directions to Anki ease values", async () => {
  const gestures = [
    { direction: "left", ease: 1, endX: 30, endY: 100 },
    { direction: "down", ease: 2, endX: 100, endY: 170 },
    { direction: "right", ease: 3, endX: 170, endY: 100 },
    { direction: "up", ease: 4, endX: 100, endY: 30 }
  ];

  for (const [index, gesture] of gestures.entries()) {
    const harness = createHarness({ isBack: true });
    const shell = harness.control.element;
    const button = shell.querySelector(".quizify-orb");
    const pointerId = index + 10;
    dispatchPointer(button, "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId
    });
    dispatchPointer(button, "pointermove", {
      clientX: gesture.endX,
      clientY: gesture.endY,
      pointerId
    });
    assert.equal(shell.dataset.direction, gesture.direction);
    dispatchPointer(button, "pointerup", {
      clientX: gesture.endX,
      clientY: gesture.endY,
      pointerId
    });
    await settle(harness.root);

    assert.deepEqual(harness.calls.answerEase, [gesture.ease]);
    disposeHarness(harness);
  }
});

test("pointercancel clears a scroll gesture and the next tap still works", async () => {
  const harness = createHarness({ isBack: false });
  const shell = harness.control.element;
  const button = shell.querySelector(".quizify-orb");

  dispatchPointer(button, "pointerdown", {
    clientX: 100,
    clientY: 100,
    pointerId: 21
  });
  dispatchPointer(button, "pointermove", {
    clientX: 102,
    clientY: 175,
    pointerId: 21
  });
  dispatchPointer(button, "pointercancel", {
    clientX: 102,
    clientY: 175,
    pointerId: 21
  });
  await settle(harness.root);

  assert.equal(harness.calls.showAnswer, 0);
  assert.equal(shell.dataset.dragging, "false");
  assert.equal(shell.dataset.positioning, "false");
  assert.equal("direction" in shell.dataset, false);
  assert.equal(shell.style.getPropertyValue("--quizify-orb-drag-x"), "0px");
  assert.equal(shell.style.getPropertyValue("--quizify-orb-drag-y"), "0px");

  dispatchPointer(button, "pointerdown", {
    clientX: 100,
    clientY: 100,
    pointerId: 22
  });
  dispatchPointer(button, "pointerup", {
    clientX: 100,
    clientY: 100,
    pointerId: 22
  });
  await settle(harness.root);
  assert.equal(harness.calls.showAnswer, 1);
  disposeHarness(harness);
});

test("an incomplete drag is not misread as a tap or rating gesture", async () => {
  const harness = createHarness({ isBack: false });
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchPointer(button, "pointerdown", {
    clientX: 100,
    clientY: 100,
    pointerId: 31
  });
  dispatchPointer(button, "pointermove", {
    clientX: 101,
    clientY: 124,
    pointerId: 31
  });
  dispatchPointer(button, "pointerup", {
    clientX: 101,
    clientY: 124,
    pointerId: 31
  });
  await settle(harness.root);

  assert.equal(harness.calls.showAnswer, 0);
  assert.deepEqual(harness.calls.answerEase, []);
  assert.match(
    harness.control.element.querySelector(".quizify-orb-status").textContent,
    /未执行/
  );
  disposeHarness(harness);
});

test("a pending rating cannot be submitted twice", async () => {
  let resolveAnswerEase;
  const answerPending = new Promise((resolve) => {
    resolveAnswerEase = resolve;
  });
  const harness = createHarness({
    isBack: true,
    answerEase: () => answerPending
  });
  const button = harness.control.element.querySelector(".quizify-orb");

  for (const pointerId of [41, 42]) {
    dispatchPointer(button, "pointerdown", {
      clientX: 100,
      clientY: 100,
      pointerId
    });
    dispatchPointer(button, "pointermove", {
      clientX: 170,
      clientY: 100,
      pointerId
    });
    dispatchPointer(button, "pointerup", {
      clientX: 170,
      clientY: 100,
      pointerId
    });
    await settle(harness.root);
  }

  assert.deepEqual(harness.calls.answerEase, [3]);
  assert.equal(harness.calls.clearAnswers, 0);
  resolveAnswerEase({ success: true });
  await settle(harness.root);
  assert.equal(harness.calls.clearAnswers, 1);
  assert.equal(harness.calls.clearReveal, 1);
  disposeHarness(harness);
});

test("touch fallback taps once and suppresses the following synthetic click", async (t) => {
  const revealed = [false, false];
  const controllers = revealed.map((_, index) => ({
    element: { isConnected: true },
    isRevealed: () => revealed[index],
    reveal() {
      revealed[index] = true;
    }
  }));
  const harness = createHarness({
    isBack: false,
    controllers,
    pointerEvents: false
  });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchTouch(button, "touchstart", { clientX: 70, clientY: 90 });
  dispatchTouch(button, "touchend", { clientX: 70, clientY: 90 });
  assert.deepEqual(revealed, [true, false]);
  dispatchClick(button, { clientX: 70, clientY: 90 });
  await settle(harness.root);

  assert.deepEqual(revealed, [true, false]);
  assert.equal(harness.calls.focus, 1);
  assert.equal(harness.calls.showAnswer, 0);
});

test("touch fallback supports swipe rating without Pointer Events", async (t) => {
  const harness = createHarness({ isBack: true, pointerEvents: false });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchTouch(button, "touchstart", { clientX: 100, clientY: 100 });
  dispatchTouch(button, "touchmove", { clientX: 165, clientY: 100 });
  dispatchTouch(button, "touchend", { clientX: 165, clientY: 100 });
  dispatchClick(button, { clientX: 165, clientY: 100 });
  await settle(harness.root);

  assert.deepEqual(harness.calls.answerEase, [3]);
});

test("click remains a basic fallback when Pointer Events are unavailable", async (t) => {
  const harness = createHarness({ isBack: false, pointerEvents: false });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchClick(button, { clientX: 60, clientY: 80 });
  await settle(harness.root);

  assert.equal(harness.calls.showAnswer, 1);
});

test("mouse drag remains a rating fallback without Pointer Events", async (t) => {
  const harness = createHarness({ isBack: true, pointerEvents: false });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchMouse(button, "mousedown", { clientX: 100, clientY: 100 });
  dispatchMouse(button, "mousemove", { clientX: 30, clientY: 100 });
  dispatchMouse(button, "mouseup", { clientX: 30, clientY: 100 });
  dispatchClick(button, { clientX: 30, clientY: 100 });
  await settle(harness.root);

  assert.deepEqual(harness.calls.answerEase, [1]);
});

test("touchcancel resets the gesture before the next touch", async (t) => {
  const harness = createHarness({ isBack: false, pointerEvents: false });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  dispatchTouch(button, "touchstart", { clientX: 100, clientY: 100 });
  dispatchTouch(button, "touchmove", { clientX: 170, clientY: 100 });
  dispatchTouch(button, "touchcancel", { clientX: 170, clientY: 100 });
  dispatchTouch(button, "touchstart", {
    clientX: 100,
    clientY: 100,
    identifier: 2
  });
  dispatchTouch(button, "touchend", {
    clientX: 100,
    clientY: 100,
    identifier: 2
  });
  await settle(harness.root);

  assert.equal(harness.calls.showAnswer, 1);
});

test("keyboard activation is handled once through the native button click", async (t) => {
  const revealed = [false, false];
  const controllers = revealed.map((_, index) => ({
    element: { isConnected: true },
    isRevealed: () => revealed[index],
    reveal() {
      revealed[index] = true;
    }
  }));
  const harness = createHarness({ isBack: false, controllers });
  t.after(() => disposeHarness(harness));
  const button = harness.control.element.querySelector(".quizify-orb");

  button.dispatchEvent(
    new harness.root.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter"
    })
  );
  assert.deepEqual(revealed, [false, false]);
  dispatchClick(button);
  await settle(harness.root);

  assert.deepEqual(revealed, [true, false]);
});
