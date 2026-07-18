const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "quizify_addon/_quizify.css"), "utf8");
const front = fs.readFileSync(path.join(root, "quizify_addon/templates/front.html"), "utf8");
const back = fs.readFileSync(path.join(root, "quizify_addon/templates/back.html"), "utf8");
const preview = fs.readFileSync(path.join(root, "docs/visual-preview.html"), "utf8");
const workbench = fs.readFileSync(path.join(root, "docs/workbench-preview.html"), "utf8");
const editorCss = fs.readFileSync(path.join(root, "quizify_addon/web/editor.css"), "utf8");
const editorJs = fs.readFileSync(path.join(root, "quizify_addon/web/editor.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "quizify_addon/settings.py"), "utf8");

for (const template of [front, back]) {
  for (const contract of ["quizify-stage", "quizify-card-header", "quizify-deck-mark", "quizify-side-label", "quizify-side-content"]) {
    assert(template.includes(contract), `template missing visual contract: ${contract}`);
  }
}
assert(back.includes('data-quizify-side="back"'));
assert(back.includes('id="answer" role="separator"'));

for (const token of ["--q-bg-deep", "--q-primary-glow", "--q-control-primary", "--q-accent", "--q-shadow-lift"]) {
  assert(css.includes(token), `missing design token: ${token}`);
}

for (const selector of [
  ".quizify-stage", ".quizify-card-header", "h1::after", "h2::before",
  "blockquote::before", ".markdown-alert", "tbody tr:nth-child(even)", "pre::before",
  ".quizify-table-scroll", ".quizify-table-scroll > table",
  "pre::after", "pre table.hljs-ln", ".hljs-ln-numbers", "--q-code-gutter",
  ".tabs-container", ".fitb input", ".choice", ".annotation", ".reveal",
  ".tab-button:focus-visible",
  ".quizify-outline", ".quizify-outline-collapse", ".quizify-outline-bullet",
  ".quizify-outline-branch::before", ".quizify-outline-breadcrumbs",
  ".collapsed-with-children", "--tree-line", "background: var(--tree-line)",
  "--outline-bullet-axis", "--outline-child-control-gap",
  ".quizify-recite", ".audio-player", ".player-controls button.play-btn",
  ".player-controls .setA-btn.active", ".progress-container:focus-visible", ".quizify-floating-control",
  "@media (max-width: 640px)", "@media (prefers-reduced-motion: reduce)"
]) {
  assert(css.includes(selector), `missing visual selector: ${selector}`);
}

for (const component of [
  "Markdown 排版", "markdown-alert-note", "tabs-container", 'class="fitb"',
  "Workflowy 风格大纲",
  'class="choice"', 'class="annotation"', 'class="reveal"',
  'class="quizify-recite"', 'class="audio-player"'
]) {
  assert(preview.includes(component), `visual preview missing component: ${component}`);
}

assert(preview.includes('class="hljs language-javascript"'), "visual preview missing highlighted code block");
assert(preview.includes('class="hljs-ln"'), "visual preview missing line-number regression fixture");
assert(preview.includes('class="tab-button active" role="tab"'), "visual preview tabs must use semantic div controls");

for (const contract of [
  "quizify-tool-button", "--qt-primary-strong",
  ".quizify-command-bar", ".quizify-inspector-panel", ".quizify-live-preview-panel", "prefers-reduced-motion"
]) {
  assert(editorCss.includes(contract) || editorJs.includes(contract), `editor workbench missing: ${contract}`);
}
for (const contract of [
  'setProperty("role", "card")', "内置离线运行时", "校验并重新同步媒体",
  "AnkiDroid 2.24+", "保存并更新模板"
]) {
  assert(settings.includes(contract), `settings panel missing: ${contract}`);
}
for (const section of ["Configuration panel", "Editor workbench", "settings-window", "quizify-toolbar-docked", "quizify-inspector-panel", "quizify-live-preview-panel"]) {
  assert(workbench.includes(section), `workbench preview missing: ${section}`);
}

console.log("visual system tests passed");
