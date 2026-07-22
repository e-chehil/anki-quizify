const assert = require("node:assert/strict");
const quizify = require("../quizify_addon/_quizify.js");
const syntax = require("../quizify_addon/web/syntax-tools.js");

function textToken(text) {
  return [{ type: "text", raw: text, text }];
}

const lexer = {
  inlineTokens(text) {
    return textToken(text);
  },
  blockTokens(text) {
    return [{ type: "paragraph", raw: text, text, tokens: textToken(text) }];
  }
};

const extensions = Object.fromEntries(
  quizify.createQuizifyExtensions().map((extension) => [extension.name, extension])
);

function tokenize(name, source) {
  return extensions[name].tokenizer.call({ lexer }, source);
}

for (const extension of Object.values(extensions)) {
  if (extension.start) {
    assert.equal(extension.start("plain markdown without quiz syntax"), undefined);
  }
}

assert.equal(tokenize("collapse", ":::\nnot a titled collapse\n:::\n"), undefined);

const nestedCollapse = tokenize(
  "collapse",
  [
    "::: Outer",
    "before",
    "::: Inner",
    "inside",
    ":::",
    "after",
    ":::",
    ""
  ].join("\n")
);
assert.equal(nestedCollapse.type, "collapse");
assert.match(nestedCollapse.raw, /after/);

const collapseWithFence = tokenize(
  "collapse",
  [
    "::: Details",
    "```text",
    ":::",
    "```",
    "still inside",
    ":::",
    ""
  ].join("\n")
);
assert.equal(collapseWithFence.type, "collapse");
assert.match(collapseWithFence.raw, /still inside/);

const tabsWithFence = tokenize(
  "tabs",
  [
    "=== One",
    "```text",
    "=== not a tab",
    "```",
    "=== Two",
    "content",
    "===",
    ""
  ].join("\n")
);
assert.equal(tabsWithFence.type, "tabs");
assert.equal(tabsWithFence.tabs.length, 2);

const mcqWithFence = tokenize(
  "mcq",
  [
    ";;;",
    "A. **Alpha**",
    "```text",
    ";;;B",
    "```",
    "B. Beta",
    ";;;B",
    ""
  ].join("\n")
);
assert.equal(mcqWithFence.type, "mcq");
assert.equal(mcqWithFence.correct, "B");
assert.equal(mcqWithFence.options.length, 2);

assert.equal(
  tokenize("mcq", ";;;\nA. Alpha\nB. Beta\n;;;C\n"),
  undefined
);
assert.equal(
  tokenize("mcq", ";;;\nA. Alpha\nA. Again\n;;;A\n"),
  undefined
);
assert.equal(
  tokenize("mcq", ";;;\nA. Alpha\nB. Beta\n;;;AAB\n").correct,
  "AB"
);

const fencedOnly = [
  "```markdown",
  "{{不是填空}}",
  ";;;",
  "A. not option",
  ";;;A",
  "::: not collapse",
  "===",
  "```"
].join("\n");
assert.deepEqual(syntax.analyzeQuizifySyntax(fencedOnly), []);
assert.deepEqual(syntax.collectQuizifyPreview(fencedOnly), []);

const diagnostics = syntax.analyzeQuizifySyntax(";;;\nA. Alpha\nB. Beta\n;;;AAB\n");
assert(diagnostics.some((item) => item.message.includes("重复字母")));

const previewAfterFence = syntax.collectQuizifyPreview([
  "```markdown",
  "{{不是填空}}",
  "```",
  "{{真实填空}}"
].join("\n"));
assert.equal(previewAfterFence.length, 1);
assert.equal(previewAfterFence[0].line, 4);

console.log("quizify nesting tests passed");
