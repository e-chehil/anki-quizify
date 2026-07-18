const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const quizify = require("../quizify_addon/_quizify.js");

function textToken(text) {
  return [{ type: "text", raw: text, text }];
}

const lexer = {
  blockTokens(text) {
    return [{ type: "paragraph", raw: text, text, tokens: textToken(text) }];
  }
};
const parser = {
  parse(tokens) {
    return tokens.map((token) => `<p>${token.text}</p>`).join("");
  }
};

const recite = quizify.createQuizifyExtensions().find((item) => item.name === "recite");
const token = recite.tokenizer.call(
  { lexer },
  ":::: recite mask=55 mode=manual\n记忆 %%三次握手%%。\n::::\n"
);
assert.equal(token.type, "recite");
assert.equal(token.mask, 55);
assert.equal(token.mode, "manual");
assert.deepEqual(recite.childTokens, ["tokens"]);
assert.match(recite.renderer.call({ parser }, token), /class="quizify-recite"/);
assert.match(recite.renderer.call({ parser }, token), /data-mask="55"/);
assert.equal(
  recite.tokenizer.call({ lexer }, ":::: recite mask=40\n未关闭"),
  undefined
);

const nested = recite.tokenizer.call(
  { lexer },
  [
    ":::: recite mask=30",
    "外层",
    ":::: recite mode=manual",
    "%%内层%%",
    "::::",
    "结束",
    "::::",
    ""
  ].join("\n")
);
assert.equal(nested.type, "recite");
assert.match(nested.raw, /结束/);

const mixed = quizify._internal.tokenizeReciteText(
  "TCP is %%面向连接%% and reliable 80% 的协议。",
  "mixed"
);
assert(mixed.some((item) => item.text === "TCP" && item.hideable));
assert(mixed.some((item) => item.text === "is" && !item.hideable));
assert(mixed.some((item) => item.text === "面向连接" && item.hideable && item.manual));
assert(mixed.some((item) => item.text === "80%" && item.hideable));
assert(mixed.some((item) => item.text === "的" && !item.hideable));

const manual = quizify._internal.tokenizeReciteText("普通文字 %%整体短语%%", "manual");
assert.equal(manual.filter((item) => item.hideable).length, 1);
assert.equal(manual.find((item) => item.hideable).text, "整体短语");

const auto = quizify._internal.tokenizeReciteText("%%Smart Recite%%", "auto");
assert.equal(auto.some((item) => item.manual), false);
assert(auto.some((item) => item.text === "Smart" && item.hideable));

assert.equal(quizify._internal.canReciteScrub("mouse", 0), true);
assert.equal(quizify._internal.canReciteScrub("pen", 0), true);
assert.equal(quizify._internal.canReciteScrub("touch", 0), false);
assert.equal(quizify._internal.canReciteScrub("mouse", 2), false);
assert.equal(quizify._internal.canArmReciteTouchScrub("touch"), true);
assert.equal(quizify._internal.canArmReciteTouchScrub("mouse"), false);
assert.equal(quizify._internal.canArmReciteTouchScrub("pen"), false);
assert.equal(quizify._internal.isReciteScrubMove(5, 0), false);
assert.equal(quizify._internal.isReciteScrubMove(6, 0), true);
assert.equal(quizify._internal.isReciteScrubMove(3, 4), false);
assert.equal(quizify._internal.isReciteScrubMove(6, 8), true);

const runtime = fs.readFileSync(
  path.join(__dirname, "../quizify_addon/_quizify.js"),
  "utf8"
);
const reciteRuntime = fs.readFileSync(
  path.join(__dirname, "../src/review/runtime/recite.js"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(__dirname, "../quizify_addon/_quizify.css"),
  "utf8"
);
for (const contract of [
  "function initRecite({",
  'kind: "recite"',
  "quizify-recite-shuffle",
  "scrubTokenAtPoint",
  'block.dataset.scrubbing = "true"',
  'canReciteScrub(',
  "if (scrub.changed) persistBlock()",
  "setMasked(token, false, false)",
  '"touchmove",',
  "{ passive: false }",
  'block.dataset.scrubbing = "armed"',
  "vibrate"
]) {
  assert(reciteRuntime.includes(contract), `missing recite module contract: ${contract}`);
}
for (const contract of [
  "quizify:v1:recite-state",
  "clearReciteState();",
  "initRecite({",
  "function canReciteScrub(pointerType",
  "function canArmReciteTouchScrub(pointerType",
  "function isReciteScrubMove(dx, dy"
]) {
  assert(runtime.includes(contract), `missing recite bundle integration: ${contract}`);
}
for (const selector of [
  ".quizify-recite",
  ".quizify-recite-token.masked",
  ".quizify-recite-token.masked.peeking",
  ".quizify-recite-toolbar",
  ".quizify-recite-shuffle",
  ".quizify-recite[data-scrubbing=true]",
  ".quizify-recite[data-scrubbing=armed]::after"
]) {
  assert(css.includes(selector), `missing recite style: ${selector}`);
}

console.log("recite tests passed");
