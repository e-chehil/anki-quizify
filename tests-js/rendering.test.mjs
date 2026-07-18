import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

const bundle = await readFile(new URL("../quizify_addon/_quizify.js", import.meta.url), "utf8");

function runtime(body = "") {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, {
    runScripts: "dangerously",
    url: "https://quizify.local/",
    virtualConsole
  });
  dom.window.TextEncoder = TextEncoder;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    font: "",
    measureText: (value) => ({ width: String(value).length * 8 })
  });
  dom.window.eval(bundle);
  return dom;
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
  assert(player.querySelector(".audio-icon-play path"));
  assert(player.querySelector(".audio-icon-pause path"));
  assert.doesNotMatch(html, /onload|<script/i);
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
  assert.match(field.textContent, /超过 512 KiB/);
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
  assert.match(breadcrumbs.textContent, /全部条目.*Camping.*Gear/);
  assert.equal(root.querySelectorAll(".quizify-outline-zoom-focus").length, 1);

  breadcrumbs.querySelector(".quizify-outline-crumb").click();
  assert(!root.classList.contains("quizify-outline-zoomed"));
  assert.equal(breadcrumbs.hidden, true);
});
