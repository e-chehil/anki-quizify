const assert = require("node:assert/strict");
const fs = require("node:fs");
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

const parser = {
  parse(tokens) {
    return tokens.map((token) => `<p>${token.text}</p>`).join("");
  },
  parseInline(tokens) {
    return tokens.map((token) => token.text).join("");
  }
};

const extensions = quizify.createQuizifyExtensions();
const byName = Object.fromEntries(extensions.map((extension) => [extension.name, extension]));

function tokenize(extension, source) {
  return extension.tokenizer.call({ lexer }, source);
}

function render(extension, token) {
  return extension.renderer.call({ parser }, token);
}

quizify._internal.resetRenderState("front-");

const fitb = tokenize(byName.fitb, "{{<answer>}}");
assert.equal(fitb.type, "fitb");
assert.equal(fitb.inputName, "front-fitb-0");
assert.match(render(byName.fitb, fitb), /data-answer="&lt;answer&gt;"/);

const mcq = tokenize(byName.mcq, ";;;\nA. **Alpha**\nB. Beta\n;;;A\n");
assert.equal(mcq.type, "mcq");
assert.equal(mcq.correct, "A");
assert.equal(mcq.options.length, 2);
assert.equal(mcq.tokens.length, 2);
assert.match(render(byName.mcq, mcq), /data-quizify-kind="single"/);

const tabs = tokenize(byName.tabs, "=== One\nFirst\n=== Two\nSecond\n===\n");
assert.equal(tabs.type, "tabs");
assert.equal(tabs.tabs.length, 2);
assert.deepEqual(byName.tabs.childTokens, ["titleTokens", "tokens"]);
assert.equal(tabs.titleTokens.length, 2);
assert.equal(tabs.tokens.length, 2);
const tabsHtml = render(byName.tabs, tabs);
assert.match(tabsHtml, /tabs-container/);
assert.match(tabsHtml, /role="tablist"/);
assert.match(tabsHtml, /class="tab-button active" role="tab"/);
assert.match(tabsHtml, /role="tabpanel"/);
assert.doesNotMatch(tabsHtml, /<button/);

const collapse = tokenize(byName.collapse, "::: Details\nBody\n:::\n");
assert.equal(collapse.type, "collapse");
assert.match(render(byName.collapse, collapse), /<details>/);

const annotation = tokenize(byName.annotation, "[term]^(note)^");
assert.equal(annotation.type, "annotation");
assert.match(render(byName.annotation, annotation), /class="tooltip"/);

const reveal = tokenize(byName.reveal, "[[question||answer]]");
assert.equal(reveal.type, "reveal");
assert.match(render(byName.reveal, reveal), /class="secret"/);

const highlight = tokenize(byName.highlight, "==key==");
assert.equal(highlight.type, "highlight");
assert.match(render(byName.highlight, highlight), /<mark>key<\/mark>/);

const superscript = tokenize(byName.superscript, "^2^");
assert.equal(superscript.type, "superscript");
assert.match(render(byName.superscript, superscript), /<sup>2<\/sup>/);

const subscript = tokenize(byName.subscript, "~2~");
assert.equal(subscript.type, "subscript");
assert.match(render(byName.subscript, subscript), /<sub>2<\/sub>/);
assert.equal(tokenize(byName.subscript, "~~deleted~~"), undefined);

const alert = tokenize(byName.githubAlert, "> [!WARNING]\n> Watch out.\n");
assert.equal(alert.type, "githubAlert");
assert.equal(alert.kind, "warning");
assert.match(render(byName.githubAlert, alert), /markdown-alert-warning/);
assert.match(render(byName.githubAlert, alert), /Watch out/);

const audio = tokenize(byName.audio, "!audio[clip](sound.mp3)");
assert.equal(audio.type, "audio");
const audioHtml = render(byName.audio, audio);
assert.match(audioHtml, /audio-player/);
assert.match(audioHtml, /class="replay-btn"/);
assert.match(audioHtml, /class="play-btn"/);
assert.match(audioHtml, /audio-icon-play/);
assert.match(audioHtml, /audio-icon-pause/);
assert.match(audioHtml, /class="setA-btn"/);
assert.match(audioHtml, /class="setB-btn"/);
assert.match(audioHtml, /class="cancelLoop-btn"/);
assert.match(audioHtml, /role="slider"/);
assert.match(audioHtml, /aria-pressed="false"/);

const quizifySource = fs.readFileSync(require.resolve("../quizify_addon/_quizify.js"), "utf8");
const audioRuntime = fs.readFileSync(
  require.resolve("../src/review/runtime/audio.js"),
  "utf8"
);
assert.match(quizifySource, /function setPlayButtonState/);
assert.match(quizifySource, /function updateLoopControls/);
assert.match(
  audioRuntime,
  /activeLifecycle\.listen\(progressContainer, "keydown"/
);
assert.match(
  audioRuntime,
  /activeLifecycle\.listen\(audio, "ended", \(\) => setPlayButtonState\(false\)\)/
);
assert.doesNotMatch(quizifySource, /playBtn\.textContent/);

assert.equal(quizify._internal.decodeAnkiFieldHtml("a<br>b&amp;c"), "a\nb&c");

console.log("quizify smoke tests passed");
