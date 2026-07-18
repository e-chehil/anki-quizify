const assert = require("node:assert/strict");
const quizify = require("../quizify_addon/_quizify.js");

let usedExtensions = null;

class FakeMarked {
  use(config) {
    usedExtensions = config.extensions;
  }

  parse(source) {
    const fitb = usedExtensions.find((extension) => extension.name === "fitb");
    const token = fitb.tokenizer.call({ lexer: { inlineTokens: () => [] } }, source);
    return fitb.renderer.call({ parser: { parseInline: () => "", parse: () => "" } }, token);
  }
}

const renderer = quizify.configureQuizifyMarked({ Marked: FakeMarked });
quizify._internal.resetRenderState("front-");

const html = renderer("{{answer}}");
assert.match(html, /class="fitb"/);
assert.match(html, /name="front-fitb-0"/);
assert.equal(quizify.state.usedIndependentMarked, true);
assert(usedExtensions.some((extension) => extension.name === "mcq"));

console.log("marked integration tests passed");
