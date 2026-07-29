import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const addon = new URL("../quizify_addon/", import.meta.url);
const reviewBundle = await readFile(new URL("_quizify.js", addon), "utf8");
const catalogBundle = await readFile(new URL("_quizify-i18n.js", addon), "utf8");

function appendClassicScript(root, source) {
  const script = root.document.createElement("script");
  script.textContent = source;
  root.document.head.appendChild(script);
}

function reviewRuntime({ side = "front", apiSource }) {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: true },
    platform: { ankidroid_api: true }
  });
  const field = side === "back"
    ? '<section id="front" class="quizify-field">Question</section><section id="back" class="quizify-field">Answer</section>'
    : '<section id="front" class="quizify-field">Question</section>';
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(
    `<!doctype html><html class="android"><head></head><body>` +
      `<script type="application/json" id="quizify-config">${config}</script>` +
      `<article class="container"><main id="note-container">${field}</main></article>` +
      `</body></html>`,
    {
      beforeParse(root) {
        root.TextEncoder = TextEncoder;
        root.HTMLCanvasElement.prototype.getContext = () => ({
          font: "",
          measureText: (value) => ({ width: String(value).length * 8 })
        });
      },
      pretendToBeVisual: true,
      runScripts: "dangerously",
      url: "https://quizify.local/",
      virtualConsole
    }
  );
  // Exercise the old-WebView path in the final bundle as well as the
  // AnkiDroid platform bridge.
  Object.defineProperty(dom.window, "PointerEvent", {
    configurable: true,
    value: undefined
  });
  appendClassicScript(dom.window, apiSource);
  appendClassicScript(dom.window, catalogBundle);
  appendClassicScript(dom.window, reviewBundle);
  dom.window.Quizify.boot({ side });
  return dom;
}

function dispatchTouch(target, type, { x, y, identifier = 1 }) {
  const root = target.ownerDocument.defaultView;
  const touch = { clientX: x, clientY: y, identifier, target };
  const ended = type === "touchend" || type === "touchcancel";
  const event = new root.Event(type, { bubbles: true, cancelable: true });
  for (const [name, value] of Object.entries({
    changedTouches: [touch],
    targetTouches: ended ? [] : [touch],
    touches: ended ? [] : [touch]
  })) {
    Object.defineProperty(event, name, { configurable: true, value });
  }
  target.dispatchEvent(event);
}

async function settle(root) {
  await Promise.resolve();
  await new Promise((resolve) => root.setTimeout(resolve, 0));
  await Promise.resolve();
}

test("release bundles are minified and stay within size budgets", async () => {
  const budgets = {
    // Complete Chinese, English and Russian catalogs shared by every runtime.
    "_quizify-i18n.js": 150_000,
    "_quizify.js": 700_000,
    // Includes both skins, bidirectional layout, embedded vector decorations,
    // and scoped resets that isolate owned controls from Anki WebView styles.
    "_quizify.css": 86_000,
    "web/editor.js": 50_000,
    "web/editor-preview.js": 750_000,
    // Includes the shared ownership-aware math scanner used by diagnostics.
    "web/syntax-tools.js": 40_000,
    "web/editor.css": 25_000
  };

  for (const [name, budget] of Object.entries(budgets)) {
    const bytes = (await stat(new URL(name, addon))).size;
    assert(
      bytes < budget,
      `${name} is not release-minified: ${bytes} bytes (budget ${budget})`
    );
    const contents = await readFile(new URL(name, addon), "utf8");
    if (name.endsWith(".js")) {
      assert.doesNotMatch(contents, /^\s*\/\/ (?:src|node_modules)\//m, name);
    } else if (name.endsWith(".css")) {
      assert.doesNotMatch(contents, /^\/\* (?:src|node_modules)\//m, name);
    }
  }
});

test("minified review bundle uses AnkiDroid's lexical API through the floating control", async () => {
  const apiSource = `
    globalThis.__quizifyCalls = [];
    class AnkiDroidJS {
      constructor(contract) { globalThis.__quizifyContract = contract; }
      ankiShowAnswer() {
        globalThis.__quizifyCalls.push("showAnswer");
        return Promise.resolve({ success: true, value: true });
      }
      ankiAnswerEase1() { return Promise.resolve({ success: true, value: true }); }
      ankiAnswerEase2() { return Promise.resolve({ success: true, value: true }); }
      ankiAnswerEase3() {
        globalThis.__quizifyCalls.push("ease3");
        return Promise.resolve({ success: true, value: true });
      }
      ankiAnswerEase4() { return Promise.resolve({ success: true, value: true }); }
    }
    globalThis.__hasApiWindowProperty = Object.prototype.hasOwnProperty.call(
      globalThis,
      "AnkiDroidJS"
    );
  `;

  const front = reviewRuntime({ side: "front", apiSource });
  assert.equal(front.window.__hasApiWindowProperty, false);
  assert.deepEqual(
    { ...front.window.__quizifyContract },
    { version: "0.0.3", developer: "chehil@163.com" }
  );
  assert.equal(front.window.Quizify.platform.describe().platform, "ankidroid");
  const frontButton = front.window.document.querySelector(".quizify-orb");
  dispatchTouch(frontButton, "touchstart", { x: 80, y: 100 });
  dispatchTouch(frontButton, "touchend", { x: 80, y: 100 });
  await settle(front.window);
  assert.deepEqual([...front.window.__quizifyCalls], ["showAnswer"]);
  front.window.Quizify.destroy();
  front.window.close();

  const back = reviewRuntime({ side: "back", apiSource });
  const backButton = back.window.document.querySelector(".quizify-orb");
  dispatchTouch(backButton, "touchstart", { x: 100, y: 100 });
  dispatchTouch(backButton, "touchmove", { x: 170, y: 100 });
  dispatchTouch(backButton, "touchend", { x: 170, y: 100 });
  await settle(back.window);
  assert.deepEqual([...back.window.__quizifyCalls], ["ease3"]);
  back.window.Quizify.destroy();
  back.window.close();
});

test("minified review bundle keeps Android-only reviewer global fallbacks", async () => {
  const apiSource = `
    globalThis.__quizifyCalls = [];
    globalThis.showAnswer = function () {
      globalThis.__quizifyCalls.push("legacy-show");
    };
    globalThis.buttonAnswerEase3 = function () {
      globalThis.__quizifyCalls.push("legacy-ease3");
    };
  `;

  const front = reviewRuntime({ side: "front", apiSource });
  const showResult = await front.window.Quizify.platform.showAnswer();
  assert.equal(showResult.success, true);
  assert.equal(showResult.transport, "ankidroid-legacy");
  assert.deepEqual([...front.window.__quizifyCalls], ["legacy-show"]);
  front.window.Quizify.destroy();
  front.window.close();

  const back = reviewRuntime({ side: "back", apiSource });
  const easeResult = await back.window.Quizify.platform.answerEase(3);
  assert.equal(easeResult.success, true);
  assert.equal(easeResult.transport, "ankidroid-legacy");
  assert.deepEqual([...back.window.__quizifyCalls], ["legacy-ease3"]);
  back.window.Quizify.destroy();
  back.window.close();
});
