const assert = require("node:assert/strict");
const syntax = require("../quizify_addon/web/syntax-tools.js");

const byId = Object.fromEntries(
  syntax.markdownActions.map((action) => [action.id, action])
);

assert.equal(syntax.formatMarkdownAction(byId.bold, "text"), "**text**");
assert.equal(syntax.formatMarkdownAction(byId.italic, "text"), "*text*");
assert.equal(syntax.formatMarkdownAction(byId["inline-code"], "x"), "`x`");
assert.equal(syntax.formatMarkdownAction(byId.link, "OpenAI"), "[OpenAI](url)");
assert.equal(syntax.formatMarkdownAction(byId.strikethrough, "old"), "~~old~~");
assert.equal(syntax.formatMarkdownAction(byId.highlight, "key"), "==key==");
assert.equal(syntax.formatMarkdownAction(byId.superscript, "2"), "^2^");
assert.equal(syntax.formatMarkdownAction(byId.subscript, "2"), "~2~");
assert.equal(syntax.formatMarkdownAction(byId.bold, "**text**"), "text");
assert.equal(syntax.formatMarkdownAction(byId.heading, "Title"), "# Title");
assert.equal(syntax.formatMarkdownAction(byId.heading, "## Title"), "Title");
assert.equal(
  syntax.formatMarkdownAction(byId.blockquote, "Line one\nLine two"),
  "> Line one\n> Line two\n"
);
assert.equal(
  syntax.formatMarkdownAction(byId["ordered-list"], "One\nTwo"),
  "1. One\n2. Two\n"
);
assert.equal(
  syntax.formatMarkdownAction(byId["ordered-list"], "1. One\n2. Two"),
  "One\nTwo"
);
assert.equal(syntax.formatMarkdownAction(byId.blockquote, "> One\n> Two"), "One\nTwo");
assert.equal(
  syntax.formatMarkdownAction(byId.blockquote, "&gt; One\n&gt; Two"),
  "One\nTwo"
);
assert.equal(
  syntax.formatMarkdownAction(byId["github-alert"], "&gt; [!NOTE]\n&gt; Notice"),
  "Notice"
);
assert.equal(
  syntax.formatMarkdownAction(byId["code-block"], "const x = 1;"),
  "```\nconst x = 1;\n```\n"
);
assert.equal(syntax.formatMarkdownAction(byId.image, "Diagram"), "![Diagram](url)");
assert.equal(syntax.formatMarkdownAction(byId.image, "![Diagram](url)"), "Diagram");
assert.match(syntax.formatMarkdownAction(byId.table, "Value"), /\| Value \| 内容 \|/);
assert.equal(
  syntax.formatMarkdownAction(byId["github-alert"], "Line one\nLine two"),
  "> [!NOTE]\n> Line one\n> Line two\n"
);
assert.equal(
  syntax.formatMarkdownAction(byId.bold, ""),
  "**粗体**",
  "empty selections should receive a useful placeholder"
);

assert.equal(byId.bold.shortcut, "Ctrl+B");
assert.equal(byId.italic.shortcut, "Ctrl+I");
assert.equal(byId.highlight.shortcut, "Ctrl+Shift+H");

console.log("Markdown editor action tests passed");
