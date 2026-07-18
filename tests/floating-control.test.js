const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const quizify = require("../quizify_addon/_quizify.js");
const {
  directionFromDelta,
  easeForDirection,
  prepareRevealContext,
  loadFloatingPosition,
  saveFloatingPosition,
  statusPlacementForCenter
} = quizify._internal;

function element(classNames = [], tagName = "div") {
  const values = new Set(classNames);
  const item = {
    tagName: tagName.toUpperCase(),
    children: [],
    parentElement: null,
    classList: {
      add(name) {
        values.add(name);
      },
      remove(name) {
        values.delete(name);
      },
      contains(name) {
        return values.has(name);
      }
    },
    append(...children) {
      children.forEach((child) => {
        child.parentElement = item;
        item.children.push(child);
      });
    },
    closest(selector) {
      let current = item;
      const className = selector.startsWith(".") ? selector.slice(1) : "";
      while (current) {
        if (className && current.classList.contains(className)) return current;
        current = current.parentElement;
      }
      return null;
    }
  };
  return item;
}

assert.equal(directionFromDelta(0, 0), null);
assert.equal(directionFromDelta(47, 0), null);
assert.equal(directionFromDelta(-60, 5), "left");
assert.equal(directionFromDelta(60, 5), "right");
assert.equal(directionFromDelta(5, -60), "up");
assert.equal(directionFromDelta(5, 60), "down");

assert.equal(easeForDirection("left"), 1);
assert.equal(easeForDirection("down"), 2);
assert.equal(easeForDirection("right"), 3);
assert.equal(easeForDirection("up"), 4);
assert.equal(easeForDirection("unknown"), null);

assert.equal(statusPlacementForCenter(80, 400), "right");
assert.equal(statusPlacementForCenter(200, 400), "right");
assert.equal(statusPlacementForCenter(320, 400), "left");

const tabGroup = element(["tabs-container"]);
const tabNav = element(["tabs-nav"], "nav");
const tabContent = element(["tabs-content"]);
const firstButton = element(["tab-button", "active"], "div");
const secondButton = element(["tab-button"], "div");
const firstPane = element(["tab-pane", "active"]);
const secondPane = element(["tab-pane"]);
const details = element([], "details");
const nestedAnswer = element(["fitb"], "span");
tabNav.append(firstButton, secondButton);
details.append(nestedAnswer);
tabContent.append(firstPane, secondPane);
secondPane.append(details);
tabGroup.append(tabNav, tabContent);

prepareRevealContext({ element: nestedAnswer });
assert.equal(firstButton.classList.contains("active"), false);
assert.equal(secondButton.classList.contains("active"), true);
assert.equal(firstPane.classList.contains("active"), false);
assert.equal(secondPane.classList.contains("active"), true);
assert.equal(details.open, true);
assert.equal(details.classList.contains("quizify-revealed"), true);

const stored = new Map();
global.localStorage = {
  getItem(key) {
    return stored.get(key) ?? null;
  },
  setItem(key, value) {
    stored.set(key, value);
  }
};
saveFloatingPosition({ x: 0.25, y: 0.75 });
assert.deepEqual(loadFloatingPosition(), { x: 0.25, y: 0.75 });
global.localStorage.setItem("quizify:v1:floating-position", '{"x":2,"y":0.5}');
assert.equal(loadFloatingPosition(), null);
delete global.localStorage;

const runtime = fs.readFileSync(
  path.join(__dirname, "../quizify_addon/_quizify.js"),
  "utf8"
);
const floatingRuntime = fs.readFileSync(
  path.join(__dirname, "../src/review/runtime/floating-control.js"),
  "utf8"
);
const orchestrator = fs.readFileSync(
  path.join(__dirname, "../src/review/orchestrator.js"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(__dirname, "../quizify_addon/_quizify.css"),
  "utf8"
);
const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../quizify_addon/config.json"), "utf8")
);

assert.equal(config.review.floating_control, true);

for (const contract of [
  "createFloatingController",
  "prepareRevealContext(next)",
  "await focusRevealedController(next)",
  "longPressDuration",
  "saveFloatingPosition",
  "restoreFloatingPosition",
  "updateStatusPlacement",
  "--quizify-orb-status-max-width",
  "cardHost.appendChild(shell)",
  "if (!shell.isConnected || root.isBack || autoFlipPending) return",
  "platform.showAnswer()",
  "platform.answerEase(ease)",
  'listen(interactionTarget, "pointercancel"',
  '"touchstart"',
  "hasPointerEvents",
  "suppressClickUntil"
]) {
  assert(floatingRuntime.includes(contract), `missing floating control module contract: ${contract}`);
}

const floatingWiring = orchestrator.slice(
  orchestrator.indexOf("createFloatingControlRuntime({"),
  orchestrator.indexOf("function destroyQuizify()")
);
for (const dependency of [
  "clearRevealProgress",
  "clearUserAnswers",
  "prefersReducedMotion"
]) {
  assert(
    floatingWiring.includes(dependency),
    `floating control dependency must be injected: ${dependency}`
  );
}

for (const contract of [
  "registerRevealController",
  "finalizeRevealControllers",
  "createFloatingControlRuntime",
  "if (!root.isBack) {",
  "clearRevealProgress();"
]) {
  assert(runtime.includes(contract), `missing floating control bundle integration: ${contract}`);
}

assert(
  !floatingRuntime.includes("root.document.body.appendChild(shell)"),
  "floating control must be owned by the replaceable card container"
);
assert(
  runtime.indexOf("clearRevealProgress();", runtime.indexOf("if (!root.isBack) {")) <
    runtime.indexOf("const userAnswers = loadUserAnswers();"),
  "new question-side state must be cleared before answers are loaded"
);

for (const selector of [
  ".quizify-floating-control",
  ".quizify-orb",
  ".quizify-orb-direction",
  "[data-status-placement=right]",
  "[data-status-placement=left]",
  ".quizify-reveal-pulse"
]) {
  assert(css.includes(selector), `missing floating control style: ${selector}`);
}

console.log("floating control tests passed");
