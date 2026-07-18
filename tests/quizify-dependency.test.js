const assert = require("node:assert/strict");

const field = {
  inserted: [],
  querySelector(selector) {
    return this.inserted.find((item) => item.className === selector.slice(1)) || null;
  },
  prepend(node) {
    this.inserted.unshift(node);
  }
};

global.document = {
  querySelectorAll(selector) {
    return selector === ".quizify-field" ? [field] : [];
  },
  createElement() {
    return { className: "", textContent: "" };
  }
};

const quizify = require("../quizify_addon/_quizify.js");

quizify.showQuizifyDependencyError("marked.js");
assert.equal(field.inserted.length, 1);
assert.equal(field.inserted[0].className, "quizify-dependency-error");
assert.match(field.inserted[0].textContent, /marked\.js 未加载/);

quizify.showQuizifyDependencyError("marked.js");
assert.equal(field.inserted.length, 1);

console.log("quizify dependency tests passed");
