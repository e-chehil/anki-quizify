const assert = require("node:assert/strict");

function codeBlock(classes) {
  const attributes = {};
  const pre = {
    dataset: {},
    setAttribute(name, value) {
      attributes[name] = value;
    }
  };
  const code = { classList: classes, parentElement: pre };
  return { code, pre, attributes };
}

const javascript = codeBlock(["hljs", "language-javascript"]);
const unknown = codeBlock(["language-rust"]);
const plain = codeBlock([]);

global.document = {
  querySelectorAll(selector) {
    assert.equal(selector, "pre > code");
    return [javascript.code, unknown.code, plain.code];
  }
};

const quizify = require("../quizify_addon/_quizify.js");
quizify._internal.initCodeBlocks();

assert.equal(javascript.pre.dataset.quizifyLanguage, "JavaScript");
assert.equal(javascript.attributes.tabindex, "0");
assert.equal(javascript.attributes["aria-label"], "JavaScript 代码块");
assert.equal(unknown.pre.dataset.quizifyLanguage, "RUST");
assert.equal(plain.pre.dataset.quizifyLanguage, "代码");

console.log("code block presentation tests passed");
