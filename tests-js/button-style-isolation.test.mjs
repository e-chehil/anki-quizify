import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(
  new URL("../src/review/styles.css", import.meta.url),
  "utf8"
);

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert(match, `missing CSS rule: ${selector}`);
  return match[1];
}

test("card layout and focus styles no longer target every native button", () => {
  assert.doesNotMatch(css, /(?:^|})\s*\*\s*\{/m);
  assert.doesNotMatch(css, /(?:^|,)\s*button:focus-visible\s*(?:,|\{)/m);
  assert.match(css, /\.quizify-stage \*:not\(button\)/);
  assert.match(css, /\.quizify-floating-control \*:not\(button\)/);
});

test("owned controls neutralize Anki button defaults before component styling", () => {
  const reset = ruleFor("button[data-quizify-control]");
  for (const declaration of [
    "-webkit-appearance: none",
    "appearance: none",
    "box-sizing: border-box",
    "margin: 0",
    "padding: 0",
    "background-image: none",
    "border: 0",
    "border-radius: 0",
    "box-shadow: none",
    "font: inherit"
  ]) {
    assert(reset.includes(declaration), `owned control reset missing: ${declaration}`);
  }

  const focus = ruleFor("button[data-quizify-control]:focus-visible");
  assert.match(focus, /outline:\s*2px solid var\(--q-primary\) !important/);
});

test("every native card control has a component selector strong enough for Anki states", () => {
  for (const selector of [
    "button.quizify-recite-shuffle",
    "button.feedback-icon",
    ".choice > button.feedback",
    ".audio-player .player-controls button",
    "button.quizify-orb",
    ".quizify-floating-control button.quizify-orb:hover",
    ".quizify-floating-control button.quizify-orb:disabled"
  ]) {
    assert(css.includes(selector), `missing owned component selector: ${selector}`);
  }

  assert(ruleFor(".audio-player .player-controls button").includes("box-shadow: none"));
  assert(ruleFor(".player-controls button:disabled").includes("box-shadow: none"));
  assert(ruleFor(".quizify-floating-control button.quizify-orb:disabled").includes("border: 0"));
});
