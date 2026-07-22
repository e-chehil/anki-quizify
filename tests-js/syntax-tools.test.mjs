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

test("syntax diagnostics and preview ignore every Quizify marker inside math", () => {
  const source = String.raw`before
$$
{{ }}
[[missing separator]]
[]^()^
!audio[]()
;;;
A. only option
;;;A
::: fake collapse
=== fake tab
:::: recite mask=999 mode=invalid
%% unpaired
$$
inline $ {{ }} + [[also missing]] + !audio[]() $
paren \({{ }} + [[also missing]]\)
bracket \[::: fake block
=== fake block
\]
after`;

  assert.deepEqual(syntax.analyzeQuizifySyntax(source), []);
  assert.deepEqual(syntax.collectQuizifyPreview(source), []);
});

test("syntax protection keeps real syntax outside math and preserves its positions", () => {
  const source = String.raw`$[[hidden reveal]]$  {{ }} and [[visible reveal]]
\({{ hidden fill }}\) !audio[](clip.mp3)
$$
::: hidden collapse
=== hidden tab
:::: recite mask=999
$$
::: visible collapse
content
:::
;;;
A. Alpha
B. Beta
;;;B`;

  const diagnostics = syntax.analyzeQuizifySyntax(source);
  assert.equal(diagnostics.length, 3);

  const fill = diagnostics.find((item) => item.message.includes("填空题答案为空"));
  const reveal = diagnostics.find((item) => item.message.includes("揭示语法缺少"));
  const audio = diagnostics.find((item) => item.message.includes("音频标题为空"));
  assert.deepEqual(
    { line: fill.line, column: fill.column },
    { line: 1, column: source.split("\n")[0].indexOf("{{ }}") + 1 }
  );
  assert.deepEqual(
    { line: reveal.line, column: reveal.column },
    { line: 1, column: source.split("\n")[0].indexOf("[[visible reveal]]") + 1 }
  );
  assert.deepEqual(
    { line: audio.line, column: audio.column },
    { line: 2, column: source.split("\n")[1].indexOf("!audio") + 1 }
  );

  const preview = syntax.collectQuizifyPreview(source);
  assert.deepEqual(
    preview.map(({ kind, line }) => ({ kind, line })),
    [
      { kind: "reveal", line: 1 },
      { kind: "fitb", line: 1 },
      { kind: "audio", line: 2 },
      { kind: "collapse", line: 8 },
      { kind: "single", line: 11 }
    ]
  );
});

test("an unmatched math opener does not expose markers in a later valid formula", () => {
  const source = String.raw`unclosed $$ leaves {{ }} visible
valid \({{ }} + [[hidden]] + !audio[]()\)
outside [[visible]]`;

  const diagnostics = syntax.analyzeQuizifySyntax(source);
  assert.deepEqual(
    diagnostics.map((item) => ({ line: item.line, message: item.message })),
    [
      { line: 1, message: "填空题答案为空。" },
      { line: 3, message: "揭示语法缺少 || 分隔符。" }
    ]
  );

  const preview = syntax.collectQuizifyPreview(source);
  assert.deepEqual(
    preview.map(({ kind, line }) => ({ kind, line })),
    [
      { kind: "fitb", line: 1 },
      { kind: "reveal", line: 3 }
    ]
  );
});

test("syntax tools ignore inline and raw code with the same precedence as rendering", () => {
  const source = [
    "`{{code}} [[code]]` Outside {{real}}",
    "<code>{{raw}} [[raw]]</code><textarea>{{raw2}}</textarea>",
    "$formula {{hidden}} `closer$` Outside [[visible||answer]]"
  ].join("\n");

  assert.deepEqual(syntax.analyzeQuizifySyntax(source), []);
  assert.deepEqual(
    syntax.collectQuizifyPreview(source).map(({ kind, line }) => ({ kind, line })),
    [
      { kind: "fitb", line: 1 },
      { kind: "reveal", line: 3 }
    ]
  );
});

test("ordinary link labels literalize interactive controls while retaining math ownership", () => {
  const source = [
    "Outside {{real}} [[visible||answer]] [shown]^(note)^",
    String.raw`\![{{ }}](safe.html)`,
    "[{{ }} [[q||a]] []^()^ and $z$](safe.html) !audio[](clip.mp3)"
  ].join("\n");

  assert.deepEqual(
    syntax.analyzeQuizifySyntax(source).map(({ line, message }) => ({ line, message })),
    [{ line: 3, message: "音频标题为空。" }]
  );

  const preview = syntax.collectQuizifyPreview(source);
  assert.deepEqual(
    preview
      .filter((item) => item.line === 1)
      .map((item) => item.kind)
      .sort(),
    ["annotation", "fitb", "reveal"]
  );
  assert.deepEqual(
    preview.filter((item) => item.line === 3).map((item) => item.kind),
    ["audio"]
  );
  assert.equal(preview.some((item) => item.line === 2), false);
});

test("image labels remain opaque to diagnostics and structure preview", () => {
  const source =
    "![{{inside}} [[q||a]] [term]^(tip)^ and $z$](safe.png)";

  assert.deepEqual(syntax.analyzeQuizifySyntax(source), []);
  assert.deepEqual(syntax.collectQuizifyPreview(source), []);
});

test("reference link labels and definitions stay out of diagnostics and preview", () => {
  const source = [
    "Outside {{real}} [[shown||answer]] [term]^(note)^",
    "[{{ }} [[q||a]] [term]^()^ and $z$][ref]",
    "[{{ }}][]",
    "[{{ }}]",
    "![{{image-full}} [[q||a]]][image]",
    "![{{image-collapsed}}][]",
    "![{{image-shortcut}}]",
    "",
    "[ref]: safe.html",
    "[{{ }}]: collapsed.html",
    "[image]: image.png",
    "[{{image-collapsed}}]: collapsed.png",
    "[{{image-shortcut}}]: shortcut.png"
  ].join("\n");

  assert.deepEqual(syntax.analyzeQuizifySyntax(source), []);
  assert.deepEqual(
    syntax.collectQuizifyPreview(source)
      .map((item) => item.kind)
      .sort(),
    ["annotation", "fitb", "reveal"]
  );
});

test("fenced and indented code masking is scoped to its Markdown container", () => {
  for (const source of [
    "~~~\n{{hidden}} [[hidden]]\n~~~\n[[visible]]",
    "> ~~~\n> {{hidden}} [[hidden]]\n> ~~~\n[[visible]]",
    "- ~~~\n  {{hidden}} [[hidden]]\n  ~~~\n\n[[visible]]",
    "- item\n  ~~~\n  {{hidden}}\n\n[[visible]]",
    "- $$\n  ~~~\n  $$\n\n[[visible]]"
  ]) {
    assert.deepEqual(
      syntax.collectQuizifyPreview(source).map(({ kind, line }) => ({ kind, line })),
      [{ kind: "reveal", line: source.split("\n").length }],
      source
    );
  }

  const ordered = [
    "10. item",
    "    {{ }}",
    "10. item",
    "",
    "        {{ hidden code }}"
  ].join("\n");
  assert.deepEqual(
    syntax.analyzeQuizifySyntax(ordered).map(({ line, message }) => ({ line, message })),
    [{ line: 2, message: "填空题答案为空。" }]
  );
  assert.deepEqual(
    syntax.collectQuizifyPreview(ordered).map(({ kind, line }) => ({ kind, line })),
    [{ kind: "fitb", line: 2 }]
  );
});
