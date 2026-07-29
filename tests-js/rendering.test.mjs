import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const bundle = await readFile(new URL("../quizify_addon/_quizify.js", import.meta.url), "utf8");
const catalogs = await readFile(
  new URL("../quizify_addon/_quizify-i18n.js", import.meta.url),
  "utf8"
);

function runtime(body = "", locale = "en") {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
    runScripts: "dangerously",
    url: "https://quizify.local/",
    virtualConsole
  });
  dom.window.TextEncoder = TextEncoder;
  dom.window.quizifyLocale = locale;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    font: "",
    measureText: (value) => ({ width: String(value).length * 8 })
  });
  dom.window.eval(catalogs);
  dom.window.eval(bundle);
  return dom;
}

test("built card runtime localizes Russian UI and falls back to English", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const body =
    `<script type="application/json" id="quizify-config">${config}</script>` +
    '<span data-quizify-i18n="common.answer">Answer</span>' +
    '<main id="note-container"><section id="front" class="quizify-field">Text</section></main>';

  const russian = runtime(body, "ru_RU");
  russian.window.Quizify.boot({ side: "front" });
  const russianLabel = russian.window.document.querySelector("[data-quizify-i18n]");
  assert.equal(russianLabel.textContent, "Ответ");
  assert.equal(russianLabel.getAttribute("lang"), "ru");

  const fallback = runtime(body, "fr_FR");
  fallback.window.Quizify.boot({ side: "front" });
  assert.equal(
    fallback.window.document.querySelector("[data-quizify-i18n]").textContent,
    "Answer"
  );
});

function renderedField(source) {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      '<main id="note-container"><section id="front" class="quizify-field"></section></main>'
  );
  dom.window.document.getElementById("front").textContent = source;
  dom.window.Quizify.boot({ side: "front" });
  return { dom, field: dom.window.document.getElementById("front") };
}

test("real Marked renders Quizify syntax and sanitizes dangerous HTML", () => {
  const dom = runtime();
  const html = dom.window.Quizify.renderMarkdown(
    "答案是 {{42}}。<img src='safe.png' onerror='alert(1)'><script>alert(2)</script>" +
      "<a href='javascript:alert(3)' style='color:red'>link</a>" +
      "<audio controls src='sample.mp3'></audio>"
  );
  assert.match(html, /class="fitb"/);
  assert.match(html, /safe\.png/);
  assert.match(html, /<audio/);
  assert.doesNotMatch(html, /onerror|<script|javascript:|style=/i);
});

test("audio controls retain safe SVG icons after sanitization", () => {
  const dom = runtime();
  const html = dom.window.Quizify.renderMarkdown(
    "!audio[听力片段](sample.mp3)" +
      "<svg onload='alert(1)'><script>alert(2)</script><path d='M0 0h1v1z'></path></svg>"
  );
  const fragment = JSDOM.fragment(html);
  const player = fragment.querySelector(".audio-player");
  assert(player);
  assert.equal(player.querySelectorAll("svg.audio-icon").length, 4);
  assert.equal(player.querySelectorAll("button[data-quizify-control]").length, 5);
  assert(player.querySelector(".audio-icon-play path"));
  assert(player.querySelector(".audio-icon-pause > *"));
  assert(
    Array.from(player.querySelectorAll("svg.audio-icon")).every(
      (icon) =>
        icon.getAttribute("viewBox") === "0 0 24 24" &&
        icon.getAttribute("aria-hidden") === "true"
    )
  );
  assert.doesNotMatch(html, /onload|<script/i);
});

test("interactive review extensions expose SVG icons and disclosure semantics", () => {
  const dom = runtime();
  const html = dom.window.Quizify.renderMarkdown(
    "> [!TIP]\n> Keep going.\n\n" +
      ":::: recite mask=40\nRemember %%this%%.\n::::\n\n" +
      "[term]^(note)^ [[question||answer]] {{42}}\n\n" +
      ";;;\nA. One\nB. Two\n;;;AB\n"
  );
  const fragment = JSDOM.fragment(html);
  const annotation = fragment.querySelector('.annotation[role="button"]');
  const reveal = fragment.querySelector('.reveal[role="button"]');
  const tooltip = fragment.querySelector('.tooltip[role="tooltip"]');

  assert(fragment.querySelector(".markdown-alert-icon"));
  assert(fragment.querySelector(".quizify-recite-shuffle-icon"));
  assert(fragment.querySelector("button.feedback-icon .fitb-feedback-symbol"));
  assert(fragment.querySelector('.choice[data-quizify-kind="multiple"] .choice-check-icon'));
  assert.equal(annotation.querySelector("svg"), null);
  assert(reveal.querySelector("svg.reveal-icon"));
  assert.deepEqual(
    Array.from(fragment.querySelectorAll("button[data-quizify-control]"), (button) =>
      button.dataset.quizifyControl
    ).sort(),
    ["choice-feedback", "fitb-reveal", "recite-shuffle"]
  );
  assert.equal(annotation.getAttribute("tabindex"), "0");
  assert.equal(annotation.getAttribute("aria-expanded"), "false");
  assert.equal(annotation.getAttribute("aria-controls"), tooltip.id);
  assert.equal(annotation.getAttribute("aria-describedby"), tooltip.id);
  assert(tooltip.querySelector(".tooltip-content"));
  assert.equal(reveal.getAttribute("tabindex"), "0");
  assert.equal(reveal.getAttribute("aria-expanded"), "false");
  assert.equal(reveal.getAttribute("aria-controls"), reveal.querySelector(".secret").id);
  assert(
    Array.from(fragment.querySelectorAll("svg")).every(
      (icon) =>
        icon.getAttribute("viewBox") === "0 0 24 24" &&
        icon.getAttribute("aria-hidden") === "true"
    )
  );
});

test("adjacent hard-broken fills stay in one paragraph with two independent controls", () => {
  const dom = runtime();
  const fragment = JSDOM.fragment(
    dom.window.Quizify.renderMarkdown("第一行 {{alpha}}  \n第二行 {{beta}}")
  );
  const paragraph = fragment.querySelector("p");

  assert(paragraph);
  assert(paragraph.querySelector("br"));
  assert.equal(paragraph.querySelectorAll(".fitb").length, 2);
  assert.deepEqual(
    Array.from(paragraph.querySelectorAll(".fitb input"), (input) => input.name),
    ["preview-fitb-0", "preview-fitb-1"]
  );
});

test("user-authored native buttons do not receive Quizify control ownership", () => {
  const dom = runtime();
  const fragment = JSDOM.fragment(
    dom.window.Quizify.renderMarkdown('<button id="user-button" type="button">Native</button>')
  );
  const button = fragment.querySelector("#user-button");

  assert(button);
  assert.equal(button.hasAttribute("data-quizify-control"), false);
});

test("reveal and annotation disclosures support keyboard operation", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      '<main id="note-container"><section id="front" class="quizify-field">[[Question||Answer]] [Term]^(Note)^</section></main>'
  );
  dom.window.Quizify.boot({ side: "front" });

  const reveal = dom.window.document.querySelector(".reveal");
  reveal.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " "
    })
  );
  assert.equal(reveal.getAttribute("aria-expanded"), "true");
  assert.equal(reveal.querySelector(".secret").getAttribute("aria-hidden"), "false");

  const annotation = dom.window.document.querySelector(".annotation");
  annotation.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter"
    })
  );
  assert.equal(annotation.getAttribute("aria-expanded"), "true");
  annotation.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape"
    })
  );
  assert.equal(annotation.getAttribute("aria-expanded"), "false");
});

test("Anki-encoded blockquotes and alerts render as block structures", () => {
  const dom = runtime();
  const source = dom.window.myquizify._internal.decodeAnkiFieldHtml(
    "&gt; 普通引用<br><br>&gt; [!NOTE]<br>&gt; 提示内容"
  );
  const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));
  assert(fragment.querySelector("blockquote"));
  assert(fragment.querySelector("aside.markdown-alert-note"));
  assert.equal(fragment.querySelector("aside.markdown-alert-note").textContent.includes(">"), false);
});

test("boot is idempotent and enforces the 512 KiB field limit", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      '<main id="note-container"><section id="front" class="quizify-field">Hello **world**</section></main>'
  );
  dom.window.Quizify.boot({ side: "front" });
  const once = dom.window.document.getElementById("front").innerHTML;
  dom.window.Quizify.boot({ side: "front" });
  assert.equal(dom.window.document.getElementById("front").innerHTML, once);

  const field = dom.window.document.getElementById("front");
  field.__quizifyMarkdownSource = "x".repeat(512 * 1024 + 1);
  dom.window.myquizify.renderQuizify("#front");
  assert.match(field.textContent, /exceeds the 512 KiB safety limit/);
});

test("annotation global listeners are released across boot and destroy", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      '<main id="note-container"><section id="front" class="quizify-field">[term]^(note)^</section></main>'
  );

  const tracked = [];
  for (const target of [dom.window.document, dom.window]) {
    const add = target.addEventListener.bind(target);
    const remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, listener, options) => {
      tracked.push({ target, type, listener, options, active: true });
      add(type, listener, options);
    };
    target.removeEventListener = (type, listener, options) => {
      const entry = tracked.find(
        (item) => item.active && item.target === target && item.type === type && item.listener === listener
      );
      if (entry) entry.active = false;
      remove(type, listener, options);
    };
  }

  const activeAnnotationGlobals = () =>
    tracked.filter(
      (item) =>
        item.active &&
        ((item.target === dom.window.document && item.type === "click") ||
          (item.target === dom.window && ["scroll", "resize"].includes(item.type)))
    );

  dom.window.Quizify.boot({ side: "front" });
  assert.equal(activeAnnotationGlobals().length, 3);
  dom.window.Quizify.boot({ side: "front" });
  assert.equal(activeAnnotationGlobals().length, 3);
  dom.window.Quizify.destroy();
  assert.equal(activeAnnotationGlobals().length, 0);
});

test("offline code highlighting, line numbers and KaTeX initialize during boot", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = "```javascript\nconst answer = 42;\nconsole.log(answer);\n```\n\n$E=mc^2$";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );
  dom.window.Quizify.boot({ side: "front" });
  assert.equal(dom.window.document.querySelectorAll(".quizify-code-line").length, 3);
  assert(dom.window.document.querySelector(".katex"));
});

test("Markdown extensions cannot consume inline or display math internals", () => {
  const dom = runtime();
  const conflictFormula =
    "$a~b~c + d~~e~~f + ==g== + {{h}} + [[i||j]] + [k]^(n)^ + *p* + [q](r) + <z>$";
  const html = dom.window.Quizify.renderMarkdown(
    "$$\n2^{128} \\approx 3.4 \\times 10^{38}\n$$\n\n" +
      conflictFormula +
      "\n\nOutside {{answer}}"
  );
  const fragment = JSDOM.fragment(html);
  const math = Array.from(fragment.querySelectorAll(".quizify-math"));

  assert.equal(math.length, 2);
  assert.equal(math[0].textContent.trim(), "2^{128} \\approx 3.4 \\times 10^{38}");
  assert.equal(math[1].textContent, conflictFormula.slice(1, -1));
  for (const element of math) {
    assert.equal(
      element.querySelectorAll(
        "sup, sub, mark, del, em, strong, a, code, .fitb, .reveal, .annotation"
      ).length,
      0
    );
  }
  assert.equal(fragment.querySelectorAll(".fitb").length, 1);
  assert.equal(fragment.querySelector(".fitb input").name, "preview-fitb-0");
  assert.equal(fragment.querySelector("z"), null, "TeX-shaped HTML stays text");
});

test("backticks inside an earlier math span stay atomic", () => {
  const dom = runtime();
  const source = "$a + `tick` + {{hidden}}$ Outside {{real}}";
  const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));

  assert.equal(fragment.querySelectorAll(".quizify-math").length, 1);
  assert.equal(
    fragment.querySelector(".quizify-math").textContent,
    "a + `tick` + {{hidden}}"
  );
  assert.equal(fragment.querySelectorAll("code").length, 0);
  assert.equal(fragment.querySelectorAll(".fitb").length, 1);
  assert.equal(fragment.querySelector(".fitb input").name, "preview-fitb-0");
});

test("display math stays atomic across Markdown-shaped block lines", () => {
  const dom = runtime();
  const formula = [
    "$$",
    "# heading-shaped TeX",
    "",
    "> quote-shaped TeX",
    "---",
    "| table | shaped |",
    "=== tab-shaped",
    ";;;",
    "$$"
  ].join("\n");
  const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(formula));
  const math = fragment.querySelector("div.quizify-math[data-quizify-math='display']");

  assert(math);
  assert.match(math.textContent, /# heading-shaped TeX/);
  assert.match(math.textContent, /\| table \| shaped \|/);
  assert.equal(
    fragment.querySelectorAll("h1, blockquote, hr, table, .tabs-container, .choice").length,
    0
  );
});

test("nested Quizify block lexers retain atomic math children", () => {
  const dom = runtime();
  const source = [
    "> [!NOTE]",
    "> Alert $x^{2}+y^{3}$",
    "",
    "::: Details",
    String.raw`Collapse \(a~b~c\)`,
    ":::",
    "",
    ";;;",
    "A. $\\frac{{a}}{{b}}$",
    "B. plain",
    ";;;A"
  ].join("\n");
  const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));

  assert(fragment.querySelector(".markdown-alert-note .quizify-math"));
  assert(fragment.querySelector("details .quizify-math"));
  assert(fragment.querySelector(".choice .quizify-math"));
  assert.equal(fragment.querySelectorAll(".quizify-math").length, 3);
  assert.equal(fragment.querySelectorAll(".quizify-math sup, .quizify-math sub").length, 0);
});

test("a block math start hint never steals links, code spans, or raw HTML", () => {
  const dom = runtime();
  const cases = [
    "[label $$\nx\n$$ tail](safe.html)",
    "`code $$\nx\n$$` after",
    "<code>$$\nx\n$$</code> after"
  ];

  const link = JSDOM.fragment(dom.window.Quizify.renderMarkdown(cases[0]));
  assert(link.querySelector("a"));
  assert.equal(link.querySelectorAll("a .quizify-math").length, 1);
  assert.equal(link.querySelector("a .quizify-math").textContent.trim(), "x");

  const code = JSDOM.fragment(dom.window.Quizify.renderMarkdown(cases[1]));
  assert.equal(code.querySelector("code").textContent, "code $$ x $$");
  assert.equal(code.querySelectorAll(".quizify-math").length, 0);

  const html = JSDOM.fragment(dom.window.Quizify.renderMarkdown(cases[2]));
  assert.match(html.querySelector("code").textContent, /\$\$\nx\n\$\$/);
  assert.equal(html.querySelectorAll(".quizify-math").length, 0);
});

test("choice option prefixes survive same-line display math", () => {
  const dom = runtime();
  const source = [
    ";;;",
    "A. prefix $$x^{2}$$ suffix",
    String.raw`B. \[y+1\]`,
    ";;;A"
  ].join("\n");
  const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));

  assert(fragment.querySelector(".choice"));
  assert.equal(fragment.querySelectorAll(".choice .option").length, 2);
  assert.deepEqual(
    Array.from(fragment.querySelectorAll(".choice .quizify-math"), (node) =>
      node.textContent
    ),
    ["x^{2}", "y+1"]
  );
});

test("container terminators inside display math never close their container", () => {
  const dom = runtime();
  const cases = [
    {
      source: ["::: Outer", "$$", "x", ":::", "y", "$$", ":::"] .join("\n"),
      selector: "details .quizify-math"
    },
    {
      source: ["=== Tab", "$$", "x", "=== ghost", "y", "$$", "==="].join("\n"),
      selector: ".tabs-container .quizify-math"
    },
    {
      source: [":::: recite", "$$", "x", "::::", "y", "$$", "::::"].join("\n"),
      selector: ".quizify-recite .quizify-math"
    },
    {
      source: ["::: Outer", "prefix $$x", ":::", "y$$", ":::"] .join("\n"),
      selector: "details .quizify-math"
    },
    {
      source: ["=== Tab", "prefix \\[x", "=== ghost", "y\\]", "==="].join("\n"),
      selector: ".tabs-container .quizify-math"
    },
    {
      source: [":::: recite", "prefix $$x", "::::", "y$$", "::::"].join("\n"),
      selector: ".quizify-recite .quizify-math"
    }
  ];

  for (const { source, selector } of cases) {
    const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));
    assert(fragment.querySelector(selector), source);
  }

  const choice = [
    ";;;",
    "A. Alpha",
    "B. Beta",
    "$$",
    ";;;A",
    "sentinel-after-inner",
    "$$",
    ";;;A"
  ].join("\n");
  const choiceFragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(choice));
  assert(choiceFragment.querySelector(".choice"));
  assert.doesNotMatch(choiceFragment.textContent, /sentinel-after-inner/);

  const inlineChoice = [
    ";;;",
    "A. Alpha",
    "B. Beta",
    "prefix $$x",
    ";;;A",
    "sentinel-after-inline",
    "y$$",
    ";;;A"
  ].join("\n");
  const inlineChoiceFragment = JSDOM.fragment(
    dom.window.Quizify.renderMarkdown(inlineChoice)
  );
  assert(inlineChoiceFragment.querySelector(".choice"));
  assert.doesNotMatch(inlineChoiceFragment.textContent, /sentinel-after-inline/);

  const unmatchedCases = [
    {
      source: ["::: Outer", "$$", ":::"].join("\n"),
      selector: "details"
    },
    {
      source: ["=== Tab", "$$", "==="].join("\n"),
      selector: ".tabs-container"
    },
    {
      source: [":::: recite", "$$", "::::"].join("\n"),
      selector: ".quizify-recite"
    },
    {
      source: [";;;", "A. Alpha", "B. Beta", "$$", ";;;A"].join("\n"),
      selector: ".choice"
    }
  ];

  for (const { source, selector } of unmatchedCases) {
    const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));
    assert(fragment.querySelector(selector), source);
  }

  for (const codeLike of ["`$$ fake`", "<code>$$ fake</code>"]) {
    const source = ["::: Outer", codeLike, ":::", "sentinel-outside"].join("\n");
    const fragment = JSDOM.fragment(dom.window.Quizify.renderMarkdown(source));
    const details = fragment.querySelector("details");
    assert(details, source);
    assert.doesNotMatch(details.textContent, /sentinel-outside/, source);
    assert.match(fragment.textContent, /sentinel-outside/, source);
  }
});

test("all supported delimiters preserve TeX exactly through real KaTeX", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`$$
2^{128} \approx 3.4 \times 10^{38}
$$

$a\_b + 50\% + \{x\} + \|v\|$

\(x^{2}+y^{3}\)

\[\frac{{a}}{{b}}\]`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const annotations = Array.from(
    dom.window.document.querySelectorAll('annotation[encoding="application/x-tex"]')
  ).map((node) => node.textContent.trim());
  assert.deepEqual(annotations, [
    String.raw`2^{128} \approx 3.4 \times 10^{38}`,
    String.raw`a\_b + 50\% + \{x\} + \|v\|`,
    "x^{2}+y^{3}",
    String.raw`\frac{{a}}{{b}}`
  ]);
  assert.equal(dom.window.document.querySelectorAll(".katex").length, 4);
  assert.equal(dom.window.document.querySelectorAll(".katex-display").length, 2);
});

test("escaped dollars stay literal while adjacent math still renders", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`Price: \$5 and \$10; formula: $x^2$; open: $not closed`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  assert.equal(field.querySelectorAll(".katex").length, 1);
  assert.equal(
    field.querySelector('annotation[encoding="application/x-tex"]').textContent,
    "x^2"
  );
  assert.match(field.textContent, /Price: \$5 and \$10/);
  assert.match(field.textContent, /open: \$not closed/);
});

test("GFM tables preserve TeX vertical bars before inline tokenization", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`| kind | value |
| --- | --- |
| norm | $\|v\|$ |`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const row = dom.window.document.querySelector("tbody tr");
  assert.equal(row.children.length, 2);
  assert.equal(
    row.querySelector('annotation[encoding="application/x-tex"]').textContent,
    String.raw`\|v\|`
  );
});

test("a malformed formula cannot break a later table formula", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`| kind | value |
| --- | --- |
| mixed | \({ broken then \(a\|b\) |`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const row = dom.window.document.querySelector("tbody tr");
  assert.equal(row.children.length, 2);
  assert.equal(
    row.querySelector('annotation[encoding="application/x-tex"]').textContent,
    String.raw`a\|b`
  );
  assert.match(row.textContent, /\(\{ broken then/);
});

test("code and link destinations cannot steal a later table formula opener", () => {
  const source = [
    "| kind | value | tail |",
    "| --- | --- | --- |",
    "| code | `code $` then $a|b$ | end |",
    String.raw`| link | [x](foo$bar\|baz$) | end |`,
    "| auto | <https://example.test/$a|b$> | end |",
    "| bare | https://example.test/$a|b$ | end |"
  ].join("\n");
  const { field } = renderedField(source);
  const rows = field.querySelectorAll("tbody tr");

  assert.equal(rows[0].children.length, 3);
  assert.equal(
    rows[0].querySelector('annotation[encoding="application/x-tex"]').textContent,
    "a|b"
  );
  assert.equal(rows[1].children.length, 3);
  assert.equal(
    rows[1].querySelector("a").getAttribute("href"),
    "foo$bar%7Cbaz$"
  );
  assert.equal(rows[2].children.length, 3);
  assert.equal(
    rows[2].querySelector("a").getAttribute("href"),
    "https://example.test/$a|b$"
  );
  assert.equal(rows[3].children.length, 3);
  assert.equal(
    rows[3].querySelector("a").getAttribute("href"),
    "https://example.test/$a|b$"
  );
});

test("link, image, reference, and title boundaries cannot steal table math", () => {
  const source = String.raw`| kind | value | tail |
| --- | --- | --- |
| link | [price $5\|label](safe.html) then $x|y$ | end |
| image | ![price $5\|alt](safe.png) then $x|y$ | end |
| ref | [price $5\|label][safe] then $x|y$ | end |
| title | [x](safe.html "title ) $5\|literal") then $x|y$ | end |
| valid | [calc $a|b$](safe.html) | end |

[safe]: /safe`;
  const { field } = renderedField(source);
  const rows = field.querySelectorAll("tbody tr");

  assert.equal(rows.length, 5);
  for (const row of rows) assert.equal(row.children.length, 3);
  for (const index of [0, 1, 2, 3]) {
    assert.equal(
      rows[index].querySelector('annotation[encoding="application/x-tex"]')
        .textContent,
      "x|y"
    );
  }
  assert.match(rows[0].querySelector("a").textContent, /\$5\|label/);
  assert.equal(rows[1].querySelector("img").alt, "price $5|alt");
  assert.match(rows[2].querySelector("a").textContent, /\$5\|label/);
  assert.equal(rows[3].querySelector("a").title, "title ) $5|literal");
  assert.equal(
    rows[4].querySelector('annotation[encoding="application/x-tex"]').textContent,
    "a|b"
  );

  const invalid = renderedField([
    "| value | tail |",
    "| --- | --- |",
    "| [x](url bad $a|b$) | end |"
  ].join("\n")).field;
  const invalidRow = invalid.querySelector("tbody tr");
  assert.equal(invalidRow.children.length, 2);
  assert.equal(invalidRow.querySelector("a"), null);
  assert.equal(
    invalidRow.querySelector('annotation[encoding="application/x-tex"]').textContent,
    "a|b"
  );
});

test("invalid reference and over-nested image labels cannot split tables", () => {
  for (const source of [
    [
      "```",
      "[ref]: /url",
      "```",
      "",
      "| value |",
      "| --- |",
      "| ![x $a|b$][ref] |"
    ].join("\n"),
    [
      "[ref]:",
      "",
      "| value |",
      "| --- |",
      "| ![x $a|b$][ref] |"
    ].join("\n"),
    ["| value |", "| --- |", "| ![a[b[c]] $x|y$](u) |"].join("\n")
  ]) {
    const { field } = renderedField(source);
    const row = field.querySelector("tbody tr");
    assert(row, source);
    assert.equal(row.children.length, 1, source);
    assert(row.querySelector(".katex"), source);
  }
});

test("fence-looking lines inside math or raw HTML cannot break a later table", () => {
  for (const prefix of [
    ["$$", "```", "$$"],
    ["<div>", "```", "</div>", ""],
    ["- item", "  ~~~", "  $code|only$", ""],
    ["- ~~~", "  $code|only$", "  ~~~", ""],
    ["- $$", "  ~~~", "  x", "  $$", ""],
    ["<custom>", "```", "</custom>", ""],
    ["<span>", "```", "</span>", ""]
  ]) {
    const source = [
      ...prefix,
      "| value | tail |",
      "| --- | --- |",
      "| $a|b$ | end |"
    ].join("\n");
    const { field } = renderedField(source);
    const row = field.querySelector("tbody tr");
    assert.equal(row.children.length, 2, source);
    assert.equal(
      row.querySelector('annotation[encoding="application/x-tex"]').textContent,
      "a|b"
    );
  }
});

test("math-looking content in code spans and fences is never rendered", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = [
    "Inline code: `$x^2^ + {{a}}$`",
    "Raw HTML code: <code>$h^2^ + {{b}}$</code>",
    "Code then text: <code>$x</code> tail $z",
    "Text then code: before $x <code>y$</code>",
    "",
    "```tex",
    "$$",
    "y^{2} + z^{3}",
    "$$",
    "```",
    "",
    "Real math: $r^2$"
  ].join("\n");
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  assert.equal(field.querySelectorAll(".katex").length, 1);
  assert.equal(field.querySelectorAll(".fitb").length, 0);
  const inlineCode = Array.from(field.querySelectorAll("p code"), (node) => node.textContent);
  assert.deepEqual(inlineCode, [
    "$x^2^ + {{a}}$",
    "$h^2^ + {{b}}$",
    "$x",
    "y$"
  ]);
  assert.match(field.textContent, /tail \$z/);
  assert.match(field.textContent, /before \$x y\$/);
  assert.match(field.querySelector("pre code").textContent, /y\^\{2\} \+ z\^\{3\}/);
});

test("raw HTML text renders math without touching attributes or ignored elements", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`<div title="$attribute$">
  <!-- $comment$ -->
  <code>$code$</code><pre>$pre$</pre><textarea>$textarea$</textarea>
  <select><option>$option$</option></select>
  <span>$x^2$</span><span>\(y+1\)</span>
  <em>before $broken <strong>tag</strong> still-broken$</em>
</div>`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  const annotations = Array.from(
    field.querySelectorAll('annotation[encoding="application/x-tex"]'),
    (node) => node.textContent
  );
  assert.deepEqual(annotations, ["x^2", "y+1"]);
  assert.equal(field.querySelector("div").getAttribute("title"), "$attribute$");
  assert.equal(field.querySelector("code").textContent, "$code$");
  assert.equal(field.querySelector("pre").textContent, "$pre$");
  assert.equal(field.querySelector("textarea").textContent, "$textarea$");
  assert.equal(field.querySelector("option").textContent, "$option$");
  assert.match(field.querySelector("em").textContent, /\$broken tag still-broken\$/);
});

test("raw HTML boundaries cannot donate a failed closer to later math", () => {
  for (const [left, right] of [["$", "$"], ["$$", "$$"]]) {
    for (const markup of [
      "<span>b</span>",
      "<code>b</code>",
      '<svg><text>b</text><path d="M0 0"></path></svg>',
      "<math><mrow><mi>b</mi></mrow></math>"
    ]) {
      const { field } = renderedField(
        `<div>before ${left}a ${markup} c${right} after ${left}d${right}</div>`
      );
      assert.deepEqual(
        Array.from(
          field.querySelectorAll('annotation[encoding="application/x-tex"]'),
          (node) => node.textContent
        ),
        ["d"],
        `${left} / ${markup}`
      );
      assert.match(field.textContent, /before \$+a .* c\$+ after/);
    }
  }
});

test("inline raw code-like elements suppress every Quizify extension", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source =
    "Lead <code>{{hidden}} $x$ ^sup^</code> " +
    "<textarea>{{hidden2}} $y$</textarea> Outside {{real}}";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  assert.equal(field.querySelector("code").textContent, "{{hidden}} $x$ ^sup^");
  assert.equal(field.querySelector("textarea").textContent, "{{hidden2}} $y$");
  assert.equal(field.querySelectorAll(".katex, code .fitb, textarea .fitb").length, 0);
  assert.equal(field.querySelectorAll(".fitb").length, 1);
  assert.equal(field.querySelector(".fitb input").name, "front-fitb-0");
});

test("HTML option implicit closes and non-void slash syntax keep math ownership", () => {
  const optionField = renderedField(
    "<select><option>$a$<option>$b$</select> outside $c$"
  ).field;
  assert.deepEqual(
    Array.from(optionField.querySelectorAll("option"), (node) => node.textContent),
    ["$a$", "$b$"]
  );
  assert.deepEqual(
    Array.from(
      optionField.querySelectorAll('annotation[encoding="application/x-tex"]'),
      (node) => node.textContent
    ),
    ["c"]
  );

  const standaloneOption = renderedField(
    "<option>$hidden$</option> outside $visible$"
  ).field;
  assert.equal(standaloneOption.querySelector("option").textContent, "$hidden$");
  assert.equal(
    standaloneOption.querySelector('annotation[encoding="application/x-tex"]').textContent,
    "visible"
  );

  const codeField = renderedField(
    "<code/>{{hidden}} $x$</code> Outside {{real}}"
  ).field;
  assert.equal(codeField.querySelector("code").textContent, "{{hidden}} $x$");
  assert.equal(codeField.querySelectorAll(".katex").length, 0);
  assert.equal(codeField.querySelectorAll(".fitb").length, 1);
  assert.equal(codeField.querySelector(".fitb input").name, "front-fitb-0");
});

test("image alt text stays literal while link labels may contain math", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = String.raw`![a $x$ and \(y\) ==mark== {{answer}} [[q||a]] ^sup^](safe.png) [link $z$](safe.html) Outside {{real}}`;
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  assert.equal(
    field.querySelector("img").alt,
    String.raw`a $x$ and \(y\) ==mark== {{answer}} [[q||a]] ^sup^`
  );
  assert.equal(field.querySelectorAll("mark, sup, .reveal").length, 0);
  assert.equal(field.querySelectorAll(".fitb").length, 1);
  assert.equal(field.querySelector(".fitb input").name, "front-fitb-0");
  assert.equal(field.querySelector("a").querySelectorAll(".katex").length, 1);
  assert.equal(
    field.querySelector('a annotation[encoding="application/x-tex"]').textContent,
    "z"
  );
});

test("nested TeX brackets stay atomic in links and literal in image alt text", () => {
  const { field } = renderedField(
    "![alt $f[x[y]]$](safe.png) [see $f[x[y]]$](safe.html)"
  );

  assert.equal(field.querySelector("img").alt, "alt $f[x[y]]$");
  const link = field.querySelector("a");
  assert(link);
  assert.equal(
    link.querySelector('annotation[encoding="application/x-tex"]').textContent,
    "f[x[y]]"
  );
  assert.equal(link.querySelectorAll(".katex").length, 1);
});

test("interactive Quizify controls in link labels stay literal while math renders", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source =
    "[{{inside}} [[q||a]] [term]^(tip)^ and $z$](safe.html) Outside {{real}}";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const field = dom.window.document.getElementById("front");
  const link = field.querySelector("a");
  assert.match(
    link.textContent,
    /\{\{inside\}\} \[\[q\|\|a\]\] \[term\]\^\(tip\)\^/
  );
  assert.equal(link.querySelectorAll("input, .reveal, .annotation").length, 0);
  assert.equal(link.querySelectorAll(".katex").length, 1);
  assert.equal(field.querySelectorAll(".fitb").length, 1);
  assert.equal(field.querySelector(".fitb input").name, "front-fitb-0");
});

test("reference links and images preserve literal labels without consuming fill counters", () => {
  const source = [
    "[{{full}} [[q||a]] [term]^(tip)^ and $z$][ref]",
    "[{{collapsed}}][]",
    "[{{shortcut}}]",
    "![{{image-full}} [[iq||ia]]][pic]",
    "![{{image-collapsed}}][]",
    "![{{image-shortcut}}]",
    "Outside {{real}}",
    "",
    "[ref]: safe.html",
    "[{{collapsed}}]: collapsed.html",
    "[{{shortcut}}]: shortcut.html",
    "[pic]: image.png",
    "[{{image-collapsed}}]: collapsed.png",
    "[{{image-shortcut}}]: shortcut.png"
  ].join("\n");
  const { field } = renderedField(source);
  const links = Array.from(field.querySelectorAll("a"));
  const images = Array.from(field.querySelectorAll("img"));

  assert.equal(links.length, 3);
  assert.match(
    links[0].textContent,
    /\{\{full\}\} \[\[q\|\|a\]\] \[term\]\^\(tip\)\^/
  );
  assert.equal(
    links.some((link) => link.querySelector("input, .reveal, .annotation")),
    false
  );
  assert.equal(links[0].querySelectorAll(".katex").length, 1);
  assert.deepEqual(
    images.map((image) => image.alt),
    [
      "{{image-full}} [[iq||ia]]",
      "{{image-collapsed}}",
      "{{image-shortcut}}"
    ]
  );
  assert.equal(field.querySelectorAll(".fitb").length, 1);
  assert.equal(field.querySelector(".fitb input").name, "front-fitb-0");
});

test("a later reveal does not make preceding links rescan the remaining field", () => {
  const dom = runtime();
  const count = 2500;
  const source = `${"[link](safe.html) ".repeat(count)}[[question||answer]]`;
  const started = performance.now();
  const html = dom.window.Quizify.renderMarkdown(source);
  const elapsed = performance.now() - started;

  assert.equal((html.match(/<a /g) || []).length, count);
  assert.match(html, /class="reveal"/);
  assert(elapsed < 1500, `link tokenization took ${elapsed.toFixed(0)} ms`);
});

test("malformed delimiter floods stay bounded", () => {
  const dom = runtime();
  const source = String.raw`\(`.repeat(32 * 1024);
  const started = performance.now();
  const html = dom.window.Quizify.renderMarkdown(source);
  const elapsed = performance.now() - started;

  assert.match(html, /Too many math delimiters/);
  assert.match(html, /\(/);
  assert(elapsed < 1500, `malformed math parse took ${elapsed.toFixed(0)} ms`);
});

test("malformed openers with distant HTML recover in one forward pass", () => {
  const dom = runtime();
  const source = String.raw`\(*a `.repeat(1024) +
    "x".repeat(256 * 1024) +
    "<";
  const started = performance.now();
  const html = dom.window.Quizify.renderMarkdown(source);
  const elapsed = performance.now() - started;

  assert.match(html, /\\\(\*a/);
  assert(elapsed < 2500, `malformed recovery took ${elapsed.toFixed(0)} ms`);
});

test("recite masking excludes both valid and failed KaTeX output", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = [
    ":::: recite mask=100 mode=auto",
    "Remember $x^2$ and $x^$.",
    "::::"
  ].join("\n");
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const math = Array.from(dom.window.document.querySelectorAll(".quizify-math"));
  assert.equal(math.length, 2);
  assert(math[0].querySelector(".katex"));
  assert(math[1].querySelector(".katex-error"));
  assert.equal(
    math.reduce(
      (count, element) => count + element.querySelectorAll(".quizify-recite-token").length,
      0
    ),
    0
  );
});

test("Markdown tables fill a dedicated responsive scroll shell", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = "| 组件 | 视觉目标 | 状态 |\n| --- | --- | --- |\n| Markdown | 阅读体验 | 完成 |";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const shell = dom.window.document.querySelector(".quizify-table-scroll");
  assert(shell);
  assert.equal(shell.children.length, 1);
  assert.equal(shell.firstElementChild.tagName, "TABLE");
  assert.equal(shell.getAttribute("role"), "region");
  assert.equal(shell.getAttribute("tabindex"), "0");

  const codeTable = dom.window.document.createElement("table");
  dom.window.document.body.appendChild(codeTable);
  const pre = dom.window.document.createElement("pre");
  pre.appendChild(codeTable);
  dom.window.document.body.appendChild(pre);
  dom.window.Quizify.enhanceMarkdownTables(dom.window.document.body);
  assert.equal(codeTable.parentElement, pre);
});

test("tabs use interactive divs with complete keyboard tab semantics", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = "=== 概念\n第一项\n=== 示例\n第二项\n===\n";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const tabList = dom.window.document.querySelector('[role="tablist"]');
  const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
  const panels = Array.from(dom.window.document.querySelectorAll('[role="tabpanel"]'));
  assert.equal(tabs.length, 2);
  assert.equal(panels.length, 2);
  assert(tabs.every((tab) => tab.tagName === "DIV"));
  assert.equal(tabList.querySelectorAll("button").length, 0);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("tabindex"), "-1");

  tabs[0].dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
  );
  assert.equal(tabs[0].getAttribute("aria-selected"), "false");
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[1].getAttribute("tabindex"), "0");
  assert.equal(panels[0].getAttribute("aria-hidden"), "true");
  assert.equal(panels[1].getAttribute("aria-hidden"), "false");
  assert(panels[1].classList.contains("active"));
});

test("nested Markdown lists become independently collapsible outlines", () => {
  const config = JSON.stringify({
    schema_version: 1,
    review: { cardless: false, floating_control: false },
    platform: { ankidroid_api: true }
  });
  const source = "- Camping\n  - Gear\n    - Tent\n  - Food\n- Inbox";
  const dom = runtime(
    `<script type="application/json" id="quizify-config">${config}</script>` +
      `<main id="note-container"><section id="front" class="quizify-field">${source}</section></main>`
  );

  dom.window.Quizify.boot({ side: "front" });
  const root = dom.window.document.querySelector(".quizify-outline");
  const toggles = Array.from(root.querySelectorAll(".quizify-outline-collapse"));
  assert(root);
  assert.equal(toggles.length, 2);
  assert.equal(root.querySelectorAll(".quizify-outline-bullet").length, 5);
  assert.equal(root.querySelectorAll("button").length, 0);
  assert(toggles.every((toggle) => toggle.tagName === "DIV"));
  assert(toggles.every((toggle) => toggle.getAttribute("role") === "button"));

  const [campingToggle, gearToggle] = toggles;
  const campingBullet = campingToggle.parentElement.querySelector(".quizify-outline-bullet");
  const gearBullet = gearToggle.parentElement.querySelector(".quizify-outline-bullet");
  const campingChildren = dom.window.document.getElementById(
    campingToggle.getAttribute("aria-controls")
  );
  const gearChildren = dom.window.document.getElementById(
    gearToggle.getAttribute("aria-controls")
  );

  gearToggle.click();
  assert.equal(gearToggle.getAttribute("aria-expanded"), "false");
  assert.equal(gearChildren.hidden, true);
  assert.equal(campingChildren.hidden, false);
  assert(gearBullet.classList.contains("collapsed-with-children"));
  assert(!campingBullet.classList.contains("collapsed-with-children"));

  campingToggle.click();
  assert.equal(campingToggle.getAttribute("aria-expanded"), "false");
  assert.equal(campingChildren.hidden, true);
  assert.equal(gearToggle.getAttribute("aria-expanded"), "false");
  assert(campingBullet.classList.contains("collapsed-with-children"));

  campingToggle.click();
  assert.equal(campingChildren.hidden, false);
  assert.equal(gearChildren.hidden, true);
  assert(!campingBullet.classList.contains("collapsed-with-children"));
  assert(gearBullet.classList.contains("collapsed-with-children"));

  gearToggle.dispatchEvent(
    new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  assert.equal(gearChildren.hidden, false);

  gearBullet.click();
  assert(root.classList.contains("quizify-outline-zoomed"));
  assert(gearBullet.getAttribute("aria-pressed") === "true");
  const breadcrumbs = root.previousElementSibling;
  assert(breadcrumbs.classList.contains("quizify-outline-breadcrumbs"));
  assert.match(breadcrumbs.textContent, /All items.*Camping.*Gear/);
  assert.equal(root.querySelectorAll(".quizify-outline-zoom-focus").length, 1);

  breadcrumbs.querySelector(".quizify-outline-crumb").click();
  assert(!root.classList.contains("quizify-outline-zoomed"));
  assert.equal(breadcrumbs.hidden, true);
});
