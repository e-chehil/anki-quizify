import assert from "node:assert/strict";
import test from "node:test";
import katex from "katex";
import { JSDOM } from "jsdom";
import { t } from "../src/shared/i18n.js";
import {
  KATEX_BLOCK_DELIMITERS,
  KATEX_DELIMITERS,
  MAX_MATH_EXPRESSIONS,
  MAX_TEX_SOURCE_LENGTH,
  findMathDelimiterEnd,
  findMathRanges,
  findMathDelimiterStart,
  hasExcessiveMathDelimiters,
  maskMath,
  matchMathDelimiter,
  protectMathPipes,
  renderMathPlaceholders
} from "../src/shared/math.js";

test("math delimiter scanner supports every public inline and display form", () => {
  const cases = [
    ["$x^2$ tail", "$", "$", "x^2", false],
    ["$$x^2$$ tail", "$$", "$$", "x^2", true],
    ["\\(x^2\\) tail", "\\(", "\\)", "x^2", false],
    ["\\[x^2\\] tail", "\\[", "\\]", "x^2", true]
  ];

  for (const [source, left, right, content, display] of cases) {
    const match = matchMathDelimiter(source);
    assert(match, source);
    assert.equal(match.left, left);
    assert.equal(match.right, right);
    assert.equal(match.text, content);
    assert.equal(match.display, display);
    assert.equal(match.raw, `${left}${content}${right}`);
  }

  assert.equal(matchMathDelimiter("$$$$").left, "$$", "longest opener wins");
  assert.equal(findMathDelimiterStart("plain \\(x\\) then $y$"), 6);
  const formulaAfterAttribute = '<span title="$x$"> then $y$';
  assert.equal(
    findMathDelimiterStart(formulaAfterAttribute),
    formulaAfterAttribute.indexOf("$y$"),
    "a formula cannot begin inside an HTML attribute"
  );
  assert.deepEqual(
    KATEX_BLOCK_DELIMITERS,
    KATEX_DELIMITERS.filter((delimiter) => delimiter.display)
  );
});

test("math delimiter scanner respects TeX escapes and brace depth", () => {
  const escapedDollar = matchMathDelimiter(String.raw`$a\$b$ rest`);
  assert.equal(escapedDollar.text, String.raw`a\$b`);

  const nestedDollar = matchMathDelimiter("$a{b$c}d$ rest");
  assert.equal(nestedDollar.text, "a{b$c}d");

  const display = KATEX_DELIMITERS.find((delimiter) => delimiter.left === "$$");
  const evenSlashes = String.raw`$$a\\$$ rest`;
  const closingIndex = findMathDelimiterEnd(
    evenSlashes,
    display,
    display.left.length
  );
  assert.equal(evenSlashes.slice(0, closingIndex + 2), String.raw`$$a\\$$`);

  assert.equal(matchMathDelimiter("$unclosed"), undefined);
  assert.equal(matchMathDelimiter("\\[unclosed"), undefined);
  assert.equal(
    matchMathDelimiter("$x<br y$").text,
    "x<br y",
    "an incomplete HTML-looking prefix remains TeX"
  );
});

test("HTML boundaries distinguish complete markup from TeX-like prefixes", () => {
  const completeMarkup = [
    "$x<br>y$",
    '$x<span title="a > b">y$',
    "$x<!-- note -->y$",
    "$x<!DOCTYPE html>y$",
    "$x<?quizify test?>y$",
    "$x<![CDATA[note]]>y$",
    '$x<svg viewBox="0 0 1 1">y$',
    "$x<svg><path d='M0 0'>y$",
    "$x<math>y$",
    "$x<math><mrow><mi>y$"
  ];
  for (const source of completeMarkup) {
    assert.equal(
      matchMathDelimiter(source),
      undefined,
      `complete markup must stop math: ${source}`
    );
  }

  assert.equal(matchMathDelimiter("$x<br y$").text, "x<br y");
  assert.equal(
    matchMathDelimiter("$x<span title='a > b$").text,
    "x<span title='a > b",
    "a greater-than sign inside an unterminated quote is not a tag end"
  );
  assert.deepEqual(
    findMathRanges("$a <span =bad> b$ outside $c$").map((match) => match.text),
    ["a <span =bad> b", "c"],
    "an invalid known-tag shape remains TeX instead of becoming a hard boundary"
  );
  assert.equal(
    matchMathDelimiter("$x<quizify>y$").text,
    "x<quizify>y",
    "unknown HTML-looking names remain available to TeX"
  );
  for (const prefix of ["<! ", "<!- ", "<![ "]) {
    assert.equal(
      matchMathDelimiter(`$x${prefix}y$`).text,
      `x${prefix}y`,
      `${prefix} is not complete HTML`
    );
  }
  for (const prefix of ["<? ", "<!-- ", "<![CDATA[ ", "<!a "]) {
    assert.equal(
      matchMathDelimiter(`$x${prefix}y$`),
      undefined,
      `${prefix} is an HTML token through EOF once its prefix is recognized`
    );
  }
  assert.equal(
    matchMathDelimiter("$x<!DOCTYPE$"),
    undefined,
    "an HTML declaration remains a boundary when its first line ends early"
  );

  const recovered = findMathRanges(
    "$broken <strong>tag</strong> tail$ then $c^2$"
  );
  assert.deepEqual(
    recovered.map((match) => match.text),
    ["c^2"],
    "a rejected HTML-crossing pair cannot donate its closer to phantom math"
  );
});

test("overlapping incomplete HTML-looking prefixes remain linear", () => {
  const started = performance.now();
  for (const chunk of ["<span ", "<span '"]) {
    const source = chunk.repeat(12000);
    assert.equal(hasExcessiveMathDelimiters(source), false);
    assert.deepEqual(findMathRanges(source), []);

    const formula = `$${chunk.repeat(200)}x$`;
    const match = matchMathDelimiter(formula);
    assert.equal(match?.raw, formula);
  }
  const elapsed = performance.now() - started;

  assert(
    elapsed < 1500,
    `indexed incomplete HTML scans took ${elapsed.toFixed(0)} ms`
  );
});

test("malformed longest delimiters recover without reusing their second dollar", () => {
  const source = "$$broken then $x$";
  const ranges = findMathRanges(source);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].raw, "$x$");
  assert.equal(ranges[0].index, source.indexOf("$x$"));

  const masked = maskMath(source);
  assert.equal(masked.slice(0, source.indexOf("$x$")), "$$broken then ");
  assert.equal(masked.slice(source.indexOf("$x$")), "xxx");
});

test("inline math never crosses code spans or physical line endings", () => {
  assert.equal(matchMathDelimiter("$a\\\nb$"), undefined);
  assert.equal(matchMathDelimiter("$a\\\rb$"), undefined);

  const source = "`$inside$ {{hidden}}` then $outside$";
  const masked = maskMath(source);
  assert.equal(masked.slice(0, source.indexOf(" then")), "`$inside$ {{hidden}}`");
  assert.equal(masked.slice(source.indexOf("$outside$")), "xxxxxxxxx");

  const mathFirst = "$a {{hidden}} `b$`";
  const mathFirstEnd = mathFirst.lastIndexOf("$") + 1;
  assert.equal(
    maskMath(mathFirst),
    "x".repeat(mathFirstEnd) + mathFirst.slice(mathFirstEnd),
    "an earlier formula opener wins over an internal code-span opener"
  );
});

test("backtick indexing preserves exact runs and backslash escape behavior", () => {
  const escapedOpener = "\\`$math$`";
  assert.equal(
    maskMath(escapedOpener),
    "\\`xxxxxx`",
    "one escaped backtick cannot open a code span"
  );

  const escapedRunPrefix = "\\``$inside$`";
  assert.equal(
    maskMath(escapedRunPrefix),
    escapedRunPrefix,
    "the unescaped suffix of a backtick run can still open a code span"
  );

  const escapedCloser = "`$inside$ \\` then $outside$";
  const escapedCloserMasked = maskMath(escapedCloser);
  assert.equal(
    escapedCloserMasked.slice(0, escapedCloser.indexOf(" then")),
    escapedCloser.slice(0, escapedCloser.indexOf(" then")),
    "backslashes do not change the exact closing run inside a code span"
  );
  assert.equal(
    escapedCloserMasked.slice(escapedCloser.indexOf("$outside$")),
    "xxxxxxxxx"
  );

  assert.equal(
    maskMath("``$visible$ ` tail"),
    "``xxxxxxxxx ` tail",
    "a shorter run cannot close or become a suffix of an unmatched opener"
  );
});

test("shared range scanning remains bounded across malformed and valid groups", () => {
  const unit = `${(String.raw`\(` + "\n").repeat(16)}\\(x\\)\n`;
  const source = unit.repeat(Math.ceil((256 * 1024) / unit.length));
  const started = performance.now();
  const masked = maskMath(source);
  const elapsed = performance.now() - started;

  assert.equal(masked.length, source.length);
  assert(elapsed < 1500, `shared math scan took ${elapsed.toFixed(0)} ms`);
});

test("unique unmatched backtick runs remain linear across every public path", () => {
  const chunks = ["|"];
  let length = 1;
  let size = 1;
  while (size < 480 * 1024) {
    const chunk = `${"`".repeat(length)}x`;
    chunks.push(chunk);
    size += chunk.length;
    length++;
  }
  const source = chunks.join("");

  const started = performance.now();
  assert.equal(hasExcessiveMathDelimiters(source), false);
  assert.equal(maskMath(source), source);
  const protectedMath = protectMathPipes(source);
  assert.equal(protectedMath.restore(protectedMath.source), source);
  const elapsed = performance.now() - started;

  assert(elapsed < 3000, `indexed backtick scans took ${elapsed.toFixed(0)} ms`);

  const matched = `| ${"`x` ".repeat(80_000)}`;
  const matchedStarted = performance.now();
  assert.equal(maskMath(matched), matched);
  const protectedMatched = protectMathPipes(matched);
  assert.equal(protectedMatched.restore(protectedMatched.source), matched);
  const matchedElapsed = performance.now() - matchedStarted;
  assert(
    matchedElapsed < 3000,
    `matched backtick scans took ${matchedElapsed.toFixed(0)} ms`
  );
});

test("table protection shields only pipes inside real math", () => {
  const source = [
    "| kind | value |",
    "| --- | --- |",
    String.raw`| math | $\|v\|$ |`,
    "| code | `$a|b$` |",
    String.raw`| cash | \$5 |`
  ].join("\n");
  const protectedMath = protectMathPipes(source);

  assert.equal(protectedMath.restore(protectedMath.source), source);
  assert.doesNotMatch(
    protectedMath.source,
    /\$\\\|v\\\|\$/,
    "math pipes must be opaque before GFM splits table cells"
  );
  assert.match(protectedMath.source, /`\$a\|b\$`/, "code spans stay untouched");
  assert.match(protectedMath.source, /\\\$5/, "escaped dollars stay untouched");

  const fenced = ["```tex", "$a|b$", "```", "", "$x|y$"].join("\n");
  const protectedFence = protectMathPipes(fenced);
  assert.equal(protectedFence.restore(protectedFence.source), fenced);

  const malformedFence = [
    "```tex",
    "$unclosed |",
    "```",
    "| kind | value |",
    "| --- | --- |",
    "| math | $x|y$ |"
  ].join("\n");
  const protectedMalformed = protectMathPipes(malformedFence);
  assert.match(protectedMalformed.source, /\$unclosed \|/);
  assert.match(protectedMalformed.source, /\| kind \| value \|/);
  assert.equal(protectedMalformed.restore(protectedMalformed.source), malformedFence);

  const collision = `\uE000\uE000 QUIZIFYMATHPIPE0TOKEN $a|b$`;
  const protectedCollision = protectMathPipes(collision);
  assert.equal(protectedCollision.restore(protectedCollision.source), collision);

  const encodedCollision =
    "| encoded %EE%80%80%EE%80%80 and undefined | $a|b$ |";
  const protectedEncodedCollision = protectMathPipes(encodedCollision);
  assert.equal(
    protectedEncodedCollision.restore(protectedEncodedCollision.source),
    encodedCollision
  );
  assert.match(protectedEncodedCollision.source, /and undefined \|/);
  assert.doesNotMatch(protectedEncodedCollision.source, /\$a\|b\$/);

  const firstPua = 0xe000;
  const puaSize = 0xf8ff - firstPua + 1;
  const encodedMarkers = [];
  for (let candidate = 0; candidate < 8000; candidate++) {
    const marker = String.fromCharCode(
      firstPua + Math.floor(candidate / puaSize),
      firstPua + (candidate % puaSize)
    );
    const encoded = encodeURIComponent(marker);
    encodedMarkers.push(candidate % 2 ? encoded.toLowerCase() : encoded);
  }
  const manyEncodedCollisions = `${encodedMarkers.join(" ")} $a|b$`;
  const collisionStarted = performance.now();
  const protectedManyCollisions = protectMathPipes(manyEncodedCollisions);
  const collisionElapsed = performance.now() - collisionStarted;
  assert.equal(
    protectedManyCollisions.restore(protectedManyCollisions.source),
    manyEncodedCollisions
  );
  assert.doesNotMatch(protectedManyCollisions.source, /\$a\|b\$/);
  assert(
    collisionElapsed < 1500,
    `encoded marker collision scan took ${collisionElapsed.toFixed(0)} ms`
  );

  const malformedThenValid = String.raw`| mixed | \({ broken \(a\|b\) |`;
  const protectedMixed = protectMathPipes(malformedThenValid);
  assert.equal(protectedMixed.restore(protectedMixed.source), malformedThenValid);
  assert.doesNotMatch(protectedMixed.source, /a\\\|b/);

  const unmatchedLongRun = "| mixed | ``unclosed $a|b$ ` |";
  const protectedUnmatched = protectMathPipes(unmatchedLongRun);
  assert.equal(protectedUnmatched.restore(protectedUnmatched.source), unmatchedLongRun);
  assert.doesNotMatch(
    protectedUnmatched.source,
    /\$a\|b\$/,
    "a shorter run cannot make an unmatched maximal opener opaque"
  );

  const mathBeforeCode = "| mixed | $a `note` b|c$ |";
  const protectedMathFirst = protectMathPipes(mathBeforeCode);
  assert.equal(protectedMathFirst.restore(protectedMathFirst.source), mathBeforeCode);
  assert.doesNotMatch(
    protectedMathFirst.source,
    /b\|c\$/,
    "an earlier math opener wins over internal backtick spans"
  );

  const codeThenMath = "| mixed | `code $` then $a|b$ |";
  const protectedCodeThenMath = protectMathPipes(codeThenMath);
  assert.equal(protectedCodeThenMath.restore(protectedCodeThenMath.source), codeThenMath);
  assert.doesNotMatch(
    protectedCodeThenMath.source,
    /\$a\|b\$/,
    "a dollar discarded inside code remains available as a later formula opener"
  );
  assert.equal(
    maskMath("`code $` then $a|b$"),
    "`code $` then xxxxx",
    "math masking restarts after the winning code range"
  );

  const linkDestination = "| link | [x](foo$bar|baz$) |";
  const protectedDestination = protectMathPipes(linkDestination);
  assert.equal(protectedDestination.source, linkDestination);
  assert.equal(protectedDestination.restore(protectedDestination.source), linkDestination);

  for (const url of [
    "<https://example.test/$a|b$>",
    "https://example.test/$a|b$"
  ]) {
    const urlSource = `| link | ${url} |`;
    const protectedUrl = protectMathPipes(urlSource);
    assert.equal(protectedUrl.restore(protectedUrl.source), urlSource);
  }

  const incompleteCode = "| mixed | <code broken $a|b$ |";
  const protectedIncompleteCode = protectMathPipes(incompleteCode);
  assert.equal(protectedIncompleteCode.restore(protectedIncompleteCode.source), incompleteCode);
  assert.doesNotMatch(
    protectedIncompleteCode.source,
    /\$a\|b\$/,
    "an incomplete code opener cannot hide a later table formula"
  );

  const slashCode = "| mixed | <code /> $a|b$ </code> then $c|d$ |";
  const protectedSlashCode = protectMathPipes(slashCode);
  assert.equal(protectedSlashCode.restore(protectedSlashCode.source), slashCode);
  assert.match(
    protectedSlashCode.source,
    /\$a\|b\$/,
    "a slash does not self-close a non-void HTML code element"
  );
  assert.doesNotMatch(protectedSlashCode.source, /\$c\|d\$/);

  for (const prefix of [
    ["$$", "```", "$$"],
    ["<div>", "```", "</div>", ""],
    ["<div", "```", ""],
    ["<pre", "```", "</pre>", ""],
    ["<custom>", "```", "</custom>", ""],
    ["<span>", "```", "</span>", ""]
  ]) {
    const sourceAfterFakeFence = [
      ...prefix,
      "| kind | tail |",
      "| --- | --- |",
      "| $a|b$ | end |"
    ].join("\n");
    const protectedAfterFakeFence = protectMathPipes(sourceAfterFakeFence);
    assert.equal(
      protectedAfterFakeFence.restore(protectedAfterFakeFence.source),
      sourceAfterFakeFence
    );
    assert.doesNotMatch(
      protectedAfterFakeFence.source,
      /\$a\|b\$/,
      "a fence-looking line owned by math or raw HTML cannot affect later tables"
    );
  }
});

test("Markdown links and images bound formula ownership", () => {
  const cases = [
    [
      "| [price $5|label](url) then $x|y$ | tail |",
      "$5|label",
      "$x|y$"
    ],
    [
      "| ![price $5|alt](pic.png) then $x|y$ | tail |",
      "$5|alt",
      "$x|y$"
    ],
    [
      "| [price $5|label][ref] then $x|y$ | tail |\n\n[ref]: /safe",
      "$5|label",
      "$x|y$"
    ],
    [
      '| [x](url "title ) $5|literal") then $x|y$ | tail |',
      "$5|literal",
      "$x|y$"
    ]
  ];

  for (const [source, literal, formula] of cases) {
    const protectedMath = protectMathPipes(source);
    assert.equal(protectedMath.restore(protectedMath.source), source);
    assert.match(protectedMath.source, new RegExp(
      literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ));
    assert.doesNotMatch(protectedMath.source, new RegExp(
      formula.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    ));
  }

  const validLabelMath = "| [calc $a|b$](url) | tail |";
  const protectedLabel = protectMathPipes(validLabelMath);
  assert.equal(protectedLabel.restore(protectedLabel.source), validLabelMath);
  assert.doesNotMatch(protectedLabel.source, /\$a\|b\$/);

  const invalidLink = "| [x](url bad $a|b$) | tail |";
  const protectedInvalidLink = protectMathPipes(invalidLink);
  assert.equal(protectedInvalidLink.restore(protectedInvalidLink.source), invalidLink);
  assert.doesNotMatch(
    protectedInvalidLink.source,
    /\$a\|b\$/,
    "an invalid Marked destination cannot make a real formula opaque"
  );

  const mathOwnsLinkLookingText = "$[a|b](url)$";
  const protectedOuterMath = protectMathPipes(mathOwnsLinkLookingText);
  assert.equal(
    protectedOuterMath.restore(protectedOuterMath.source),
    mathOwnsLinkLookingText
  );
  assert.doesNotMatch(protectedOuterMath.source, /a\|b/);

  assert.equal(
    maskMath("[price $5|label][ref] then $x|y$\n\n[ref]: /safe"),
    "[price $5|label][ref] then xxxxx\n\n[ref]: /safe"
  );
});

test("unterminated opaque HTML prefixes are skipped once", () => {
  const source = `| ${"<!--".repeat(20_000)} $a|b$ |`;
  const started = performance.now();
  const protectedMath = protectMathPipes(source);
  const elapsed = performance.now() - started;

  assert.equal(protectedMath.source, source);
  assert.equal(protectedMath.restore(protectedMath.source), source);
  assert(elapsed < 1000, `opaque HTML scan took ${elapsed.toFixed(0)} ms`);
});

test("malformed link and audio floods remain linear during table protection", () => {
  for (const chunk of ["[x](", "!audio["]) {
    const source = `|${chunk.repeat(12000)}`;
    const started = performance.now();
    const protectedMath = protectMathPipes(source);
    assert.equal(protectedMath.restore(protectedMath.source), source);
    const elapsed = performance.now() - started;
    assert(elapsed < 1000, `${chunk} recovery took ${elapsed.toFixed(0)} ms`);
  }
});

test("a distant formula is cached across large runs of inline code", () => {
  const source = `| ${"`x` ".repeat(64000)}$a|b$`;
  const started = performance.now();
  assert.match(maskMath(source), /xxxxx$/);
  const protectedMath = protectMathPipes(source);
  assert.equal(protectedMath.restore(protectedMath.source), source);
  const elapsed = performance.now() - started;
  assert(elapsed < 1000, `code-span ownership took ${elapsed.toFixed(0)} ms`);
});

test("only valid, active reference definitions can make image labels opaque", () => {
  const cases = [
    [
      "```",
      "[ref]: /url",
      "```",
      "| C |",
      "|---|",
      "| ![x $a|b$][ref] |"
    ].join("\n"),
    ["[ref]:", "", "| C |", "|---|", "| ![x $a|b$][ref] |"].join("\n"),
    ["| C |", "|---|", "| ![a[b[c]] $x|y$](u) |"].join("\n")
  ];

  for (const source of cases) {
    const protectedMath = protectMathPipes(source);
    assert.equal(protectedMath.restore(protectedMath.source), source);
    assert.notEqual(protectedMath.source, source, source);
  }
});

test("KaTeX renders only explicit sanitized math placeholders", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <main id="host">
      <span class="quizify-math" data-quizify-math="inline">a\\_b</span>
      <div class="quizify-math" data-quizify-math="display">x^{2}</div>
      <span>$not-scanned$</span>
    </main>
  </body>`);
  const host = dom.window.document.getElementById("host");
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    assert.equal(renderMathPlaceholders(host, katex), 2);
    assert.equal(host.querySelectorAll(".katex").length, 2);
    assert.equal(host.querySelectorAll(".katex-display").length, 1);
    assert.equal(host.querySelectorAll("[data-quizify-math]").length, 0);
    assert.equal(
      host.querySelector('annotation[encoding="application/x-tex"]').textContent,
      String.raw`a\_b`
    );
    assert.match(host.textContent, /\$not-scanned\$/);
    assert.equal(renderMathPlaceholders(host, katex), 0, "rendering is idempotent");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("KaTeX rejects mutable macro definitions before they can amplify output", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <main id="host">
      <span id="unsafe" class="quizify-math" data-quizify-math="inline"></span>
      <span id="normal" class="quizify-math" data-quizify-math="inline">x+1</span>
    </main>
  </body>`);
  const host = dom.window.document.getElementById("host");
  const unsafe = dom.window.document.getElementById("unsafe");
  const amplified = String.raw`\def\a{${"x".repeat(500)}}${String.raw`\a`.repeat(250)}`;
  unsafe.textContent = amplified;
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;

  try {
    const started = performance.now();
    assert.equal(renderMathPlaceholders(host, katex), 1);
    assert(performance.now() - started < 1000);
    assert(unsafe.classList.contains("quizify-math-error"));
    assert.equal(
      unsafe.getAttribute("title"),
      `KaTeX: ${t("math.macros_disabled")}`
    );
    assert.equal(unsafe.textContent, amplified);
    assert.equal(unsafe.querySelectorAll("*").length, 0);
    assert(host.querySelector("#normal .katex"));
  } finally {
    globalThis.document = previousDocument;
  }
});

test("math rendering enforces source, count, tag, and KaTeX safety budgets", () => {
  const dom = new JSDOM("<!doctype html><body><main id='host'></main></body>");
  const host = dom.window.document.getElementById("host");
  const options = [];
  const fakeKatex = {
    render(source, element, renderOptions) {
      options.push(renderOptions);
      element.textContent = `rendered:${source}`;
    }
  };

  const forged = dom.window.document.createElement("img");
  forged.className = "quizify-math";
  forged.setAttribute("data-quizify-math", "inline");
  forged.setAttribute("alt", "must stay intact");
  host.appendChild(forged);

  const long = dom.window.document.createElement("span");
  long.className = "quizify-math";
  long.setAttribute("data-quizify-math", "inline");
  long.textContent = "x".repeat(MAX_TEX_SOURCE_LENGTH + 1);
  host.appendChild(long);

  for (let index = 0; index <= MAX_MATH_EXPRESSIONS; index++) {
    const formula = dom.window.document.createElement("span");
    formula.className = "quizify-math";
    formula.setAttribute("data-quizify-math", "inline");
    formula.textContent = "x";
    host.appendChild(formula);
  }

  assert.equal(renderMathPlaceholders(host, fakeKatex), MAX_MATH_EXPRESSIONS - 1);
  assert.equal(forged.getAttribute("alt"), "must stay intact");
  assert.equal(options.length, MAX_MATH_EXPRESSIONS - 1);
  assert(options.every((item) => item.trust === false));
  assert(options.every((item) => item.maxExpand === 100 && item.maxSize === 100));
  assert.equal(new Set(options.map((item) => item.macros)).size, options.length);
  assert(host.querySelectorAll(".quizify-math-error").length >= 2);
});

test("delimiter flood guard cannot be bypassed by Markdown container state", () => {
  const flood = String.raw`\(`.repeat(5000);
  assert.equal(hasExcessiveMathDelimiters(flood), true);
  assert.equal(
    hasExcessiveMathDelimiters(`\`${flood}\``),
    true,
    "extreme inline code is conservatively capped because custom tokens can split it"
  );
  assert.equal(
    hasExcessiveMathDelimiters(`$\`${flood}\`$`),
    true,
    "backticks inside an earlier formula cannot hide a delimiter flood"
  );
  assert.equal(
    hasExcessiveMathDelimiters(`<code ${flood}`),
    true,
    "an incomplete raw-code opener is not an HTML context"
  );
  assert.equal(
    hasExcessiveMathDelimiters(`<code />${flood}`),
    true,
    "a self-closing raw-code tag cannot hide following text"
  );
  assert.equal(
    hasExcessiveMathDelimiters(`<code>${flood}</code>`),
    true,
    "the raw hard cap is independent of HTML ownership"
  );
  for (const prefix of ["<! ", "<!- ", "<![ "]) {
    assert.equal(hasExcessiveMathDelimiters(prefix + flood), true);
  }
  for (const prefix of ["<? ", "<!-- ", "<![CDATA[ ", "<!a "]) {
    assert.equal(hasExcessiveMathDelimiters(prefix + flood), true);
  }
  assert.equal(
    hasExcessiveMathDelimiters("[x `]^(tip)^ " + flood + "`"),
    true,
    "a custom inline token cannot lend its backtick to following text"
  );
  assert.equal(
    hasExcessiveMathDelimiters(["~~~tex", flood, "~~~~"].join("\n")),
    true,
    "the hard cap also covers extreme fenced-code input"
  );
  assert.equal(
    hasExcessiveMathDelimiters(["```tex", flood, "````"].join("\n")),
    true,
    "fence classification is never trusted by the hard cap"
  );
  assert.equal(
    hasExcessiveMathDelimiters(["```bad`", flood].join("\n")),
    true,
    "a backtick in the info string makes a CommonMark fence invalid"
  );
  for (const prefix of [
    ["- item", "  ~~~", "  code", ""],
    ["- ~~~", "  code", "  ~~~", ""],
    ["- $$", "  ~~~", "  $$", ""]
  ]) {
    assert.equal(
      hasExcessiveMathDelimiters([...prefix, flood].join("\n")),
      true,
      "list-local Markdown state cannot hide an external delimiter flood"
    );
  }
  assert.equal(
    hasExcessiveMathDelimiters(["$$", "```", "x", "$$", flood].join("\n")),
    true,
    "a fence-looking line inside display math cannot hide following text"
  );
  assert.equal(
    hasExcessiveMathDelimiters(
      ["<div>", "```", "</div>", "", flood].join("\n")
    ),
    true,
    "a fence-looking line inside raw HTML cannot hide following text"
  );
  assert.equal(
    hasExcessiveMathDelimiters(String.raw`\$5 `.repeat(5000)),
    false
  );
  assert.equal(
    hasExcessiveMathDelimiters(String.raw`\$$ `.repeat(5000)),
    true,
    "an escaped first dollar cannot hide its overlapping unescaped neighbor"
  );
  assert.equal(
    hasExcessiveMathDelimiters(String.raw`\$\$ `.repeat(5000)),
    false,
    "individually escaped dollars remain ordinary text"
  );
});
