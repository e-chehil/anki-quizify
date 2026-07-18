const assert = require("node:assert/strict");
const quizify = require("../quizify_addon/_quizify.js");

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

const samples = {
  githubAlert: "> [!WARNING]\n> Watch out.\n",
  recite: ":::: recite mask=40\nRemember this.\n::::\n",
  collapse: "::: Details\nBody\n:::\n",
  tabs: "=== One\nFirst\n=== Two\nSecond\n===\n",
  annotation: "[term]^(note)^",
  highlight: "==key==",
  fitb: "{{answer}}",
  reveal: "[[question||answer]]",
  superscript: "^2^",
  subscript: "~2~",
  mcq: ";;;\nA. Alpha\nB. Beta\n;;;A\n",
  audio: "!audio[clip](sound.mp3)",
  mathInline: "\\(x + y\\)",
  mathBlock: "\\[x + y\\]"
};

for (const extension of quizify.createQuizifyExtensions()) {
  assert.equal(typeof extension.name, "string");
  assert(extension.name);
  assert(["block", "inline"].includes(extension.level));
  assert.equal(typeof extension.start, "function");
  assert.equal(typeof extension.tokenizer, "function");
  assert.equal(typeof extension.renderer, "function");

  const noMatchStart = extension.start("plain markdown");
  assert(noMatchStart === undefined || (Number.isInteger(noMatchStart) && noMatchStart >= 0));

  const source = samples[extension.name];
  assert(source, `missing sample for ${extension.name}`);
  const token = extension.tokenizer.call({ lexer }, source);
  assert(token, `sample did not tokenize for ${extension.name}`);
  assert.equal(token.type, extension.name);
  assert.equal(typeof token.raw, "string");
  assert(token.raw.length > 0);

  for (const child of extension.childTokens || []) {
    assert(Array.isArray(token[child]), `${extension.name}.${child} must be a token array`);
  }
}

let useCalls = 0;
const markedApi = {
  use() {
    useCalls++;
  },
  parse(source) {
    return source;
  }
};

const first = quizify.configureQuizifyMarked(markedApi);
const second = quizify.configureQuizifyMarked(markedApi);
assert.equal(first, second);
assert.equal(useCalls, 1);

console.log("marked extension contract tests passed");
