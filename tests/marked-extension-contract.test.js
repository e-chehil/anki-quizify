const assert = require("node:assert/strict");
const quizify = require("../quizify_addon/_quizify.js");

function textToken(text) {
  return [{ type: "text", raw: text, text }];
}

const lexer = {
  tokenizer: {
    link(source) {
      const image = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(source);
      if (image) {
        return {
          type: "image",
          raw: image[0],
          text: image[1],
          href: image[2],
          title: null,
          tokens: textToken(image[1])
        };
      }
      const link = /^\[([^\]]*)\]\(([^)]*)\)/.exec(source);
      if (!link) return;
      return {
        type: "link",
        raw: link[0],
        text: link[1],
        href: link[2],
        title: null,
        tokens: textToken(link[1])
      };
    }
  },
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
  mathBlock: "\\[x + y\\]",
  rawIgnoredElement: "<code>$x$</code>",
  literalImage: "![alt](image.png)",
  safeLink: "[label](safe.html)"
};

for (const extension of quizify.createQuizifyExtensions()) {
  assert.equal(typeof extension.name, "string");
  assert(extension.name);
  assert(["block", "inline"].includes(extension.level));
  assert(
    extension.start === undefined || typeof extension.start === "function",
    `${extension.name}.start must be an optional Marked start hint`
  );
  assert.equal(typeof extension.tokenizer, "function");
  const builtinTokenExtension =
    extension.name === "literalImage" || extension.name === "safeLink";
  if (builtinTokenExtension) {
    assert(
      extension.renderer === undefined || typeof extension.renderer === "function",
      `${extension.name}.renderer must be optional for its built-in token type`
    );
  } else {
    assert.equal(
      typeof extension.renderer,
      "function",
      `${extension.name}.renderer must render its custom token type`
    );
  }

  if (extension.start) {
    const noMatchStart = extension.start("plain markdown");
    assert(
      noMatchStart === undefined ||
        (Number.isInteger(noMatchStart) && noMatchStart >= 0)
    );
  }

  const source = samples[extension.name];
  assert(source, `missing sample for ${extension.name}`);
  const token = extension.tokenizer.call({ lexer }, source);
  assert(token, `sample did not tokenize for ${extension.name}`);
  const expectedType = {
    literalImage: "image",
    safeLink: "link"
  }[extension.name] || extension.name;
  assert.equal(token.type, expectedType);
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
