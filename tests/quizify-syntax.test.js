const assert = require("node:assert/strict");
const syntax = require("../quizify_addon/web/syntax-tools.js");

const valid = [
  "# Quizify",
  "{{答案}}",
  "[[题干||答案]]",
  "[术语]^(解释)^",
  "::: 折叠",
  "内容",
  ":::",
  "=== A",
  "内容 A",
  "=== B",
  "内容 B",
  "===",
  ";;;",
  "A. 选项 A",
  "B. 选项 B",
  ";;;A",
  "!audio[片段](clip.mp3)",
  ":::: recite mask=40 mode=mixed",
  "背诵 %%整体短语%% 内容",
  "::::"
].join("\n");

assert.deepEqual(syntax.analyzeQuizifySyntax(valid), []);

const invalid = [
  "{{ }}",
  "[[缺少分隔符]]",
  ";;;",
  "A. 选项 A",
  ";;;B",
  "::: 未关闭",
  "=== Only",
  "body"
].join("\n");

const diagnostics = syntax.analyzeQuizifySyntax(invalid);
assert(diagnostics.some((item) => item.message.includes("填空题答案为空")));
assert(diagnostics.some((item) => item.message.includes("揭示语法缺少")));
assert(diagnostics.some((item) => item.message.includes("答案 B 没有对应选项")));
assert(diagnostics.some((item) => item.message.includes("折叠块缺少结束标记")));
assert(diagnostics.some((item) => item.message.includes("标签页缺少结束标记")));
assert.match(syntax.summarizeDiagnostics(diagnostics), /错误|警告/);

const preview = syntax.collectQuizifyPreview(valid);
assert(preview.some((item) => item.kind === "fitb" && item.meta.answer === "答案"));
assert(preview.some((item) => item.kind === "single" && item.meta.answers === "A"));
assert(preview.some((item) => item.kind === "collapse" && item.meta.title === "折叠"));
assert(preview.some((item) => item.kind === "tab" && item.meta.title === "A"));
assert(preview.some((item) => item.kind === "audio" && item.meta.url === "clip.mp3"));
assert(preview.some((item) => item.kind === "recite" && item.meta.mask === "40"));

const invalidRecite = syntax.analyzeQuizifySyntax([
  ":::: recite mask=120 mode=random unknown=yes",
  "未配对的 %%分组",
  "::::"
].join("\n"));
assert(invalidRecite.some((item) => item.message.includes("0 到 100")));
assert(invalidRecite.some((item) => item.message.includes("auto、manual 或 mixed")));
assert(invalidRecite.some((item) => item.message.includes("未知背诵参数")));
assert(invalidRecite.some((item) => item.message.includes("缺少配对")));

const unclosedRecite = syntax.analyzeQuizifySyntax(":::: recite\n内容");
assert(unclosedRecite.some((item) => item.message.includes("缺少结束标记 ::::")));

console.log("quizify syntax tests passed");
