import assert from "node:assert/strict";
import test from "node:test";

await import("../src/shared/syntax-tools.js");

const syntax = globalThis.QuizifySyntax;

test("syntax diagnostics preserve CRLF line and column positions", () => {
  const source = [
    "prefix",
    "  {{ }} and [[missing separator]]",
    "text !audio[](clip.mp3)"
  ].join("\r\n");

  const diagnostics = syntax.analyzeQuizifySyntax(source);
  const fill = diagnostics.find((item) => item.message.includes("填空题答案为空"));
  const reveal = diagnostics.find((item) => item.message.includes("揭示语法缺少"));
  const audio = diagnostics.find((item) => item.message.includes("音频标题为空"));

  assert.deepEqual(
    { line: fill.line, column: fill.column },
    { line: 2, column: 3 }
  );
  assert.deepEqual(
    { line: reveal.line, column: reveal.column },
    { line: 2, column: 13 }
  );
  assert.deepEqual(
    { line: audio.line, column: audio.column },
    { line: 3, column: 6 }
  );

  const preview = syntax.collectQuizifyPreview(source);
  assert.equal(preview.find((item) => item.kind === "fitb").line, 2);
  assert.equal(preview.find((item) => item.kind === "reveal").line, 2);
  assert.equal(preview.find((item) => item.kind === "audio").line, 3);
});

test("syntax diagnostics avoid repeated full-prefix scans on large fields", () => {
  const lineCount = 20_000;
  const source = Array.from(
    { length: lineCount },
    (_, index) => `  {{ }} item ${index}`
  ).join("\n");
  const originalSlice = String.prototype.slice;
  let fullSourcePrefixSlices = 0;

  String.prototype.slice = function patchedSlice(start, end) {
    if (this.length === source.length && start === 0 && typeof end === "number") {
      fullSourcePrefixSlices++;
    }
    return originalSlice.call(this, start, end);
  };

  let diagnostics;
  try {
    diagnostics = syntax.analyzeQuizifySyntax(source);
  } finally {
    String.prototype.slice = originalSlice;
  }

  assert.equal(diagnostics.length, lineCount);
  assert.deepEqual(
    {
      line: diagnostics.at(-1).line,
      column: diagnostics.at(-1).column
    },
    { line: lineCount, column: 3 }
  );
  assert.equal(fullSourcePrefixSlices, 0);
});
