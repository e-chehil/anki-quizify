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
const reviewSourceCss = fs.readFileSync(path.join(root, "src/review/styles.css"), "utf8");

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = reviewSourceCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert(match, `missing source CSS rule: ${selector}`);
  return match[1];
}

function customProperties(rule) {
  return new Set(Array.from(rule.matchAll(/(--q-[a-z0-9-]+)\s*:/g), (match) => match[1]));
}

function rulesContainingSelector(selector) {
  return Array.from(reviewSourceCss.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) =>
      match[1]
        .split(",")
        .map((item) => item.trim())
        .includes(selector)
    )
    .map((match) => match[2]);
}

function declarationValue(rule, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return rule.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+)`))?.[1].trim();
}

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

const choiceRule = ruleFor(".choice");
const checkmarkRule = ruleFor(".checkmark");
const optionSequenceRule = ruleFor(".option-seq");
assert(choiceRule.includes("--q-choice-marker-size: 28px"));
for (const markerRule of [checkmarkRule, optionSequenceRule]) {
  assert(markerRule.includes("width: var(--q-choice-marker-size)"));
  assert(markerRule.includes("height: var(--q-choice-marker-size)"));
  assert(markerRule.includes("margin: 0 12px 0 0"));
}
assert(checkmarkRule.includes("box-sizing: border-box"));

const baseThemeRule = ruleFor(":host");
const gezhiLightRule = ruleFor(':host([data-quizify-theme="gezhi"])');
const gezhiNightRule = ruleFor(':host(.night-mode) [data-quizify-theme="gezhi"]');
const baseThemeTokens = customProperties(baseThemeRule);
for (const [mode, themeRule] of [["light", gezhiLightRule], ["night", gezhiNightRule]]) {
  const themeTokens = customProperties(themeRule);
  for (const token of baseThemeTokens) {
    assert(themeTokens.has(token), `格致 ${mode} theme missing token: ${token}`);
  }
}
for (const contract of [
  '--q-bg: #e4dfd7', '--q-surface: #fffefa', '--q-text: #475164',
  '--q-primary: #126e82', '--q-accent: #db8540', '--q-radius: 8px',
  'Georgia', '"Songti SC"', 'STSong', 'SimSun', 'serif'
]) {
  assert(gezhiLightRule.includes(contract), `格致 light theme missing contract: ${contract}`);
}
for (const contract of [
  '--q-bg: #22202e', '--q-surface: #322f3b', '--q-text: #c0c4c3',
  '--q-primary: #66a9c9', '--q-accent: #db8540', '--q-radius: 8px',
  '--q-shadow:', '--q-code-bg:', '--q-tooltip-bg:'
]) {
  assert(gezhiNightRule.includes(contract), `格致 night theme missing contract: ${contract}`);
}
for (const contract of [
  '--q-gezhi-selection-fg: #ffffff', '--q-gezhi-selection-bg: #5e7987',
  '--q-gezhi-bold-italic: #cf4813', '--q-gezhi-reveal-fg: #2376b7',
  '--q-gezhi-reveal-hover-bg: #f7c173', '--q-gezhi-table-bg: #e5d3aa',
  '--q-gezhi-divider: #8a988e', '--q-gezhi-shell-shadow: 0 4px 6px #d4c4b740',
  '--q-choice-feedback-fg: #fffefa', '--q-choice-feedback-bg: #c1b2a3',
  '--q-choice-correct-fg: #1a6840', '--q-choice-correct-bg: #f0f5e5',
  '--q-choice-incorrect-fg: #a61b29', '--q-choice-incorrect-bg: #fbeee2',
  '--q-choice-incomplete-fg: #5e5314', '--q-choice-incomplete-bg: #f9f4dc'
]) {
  assert(gezhiLightRule.includes(contract), `格致 light missing legacy detail: ${contract}`);
}
for (const contract of [
  '--q-gezhi-selection-fg: #000000', '--q-gezhi-selection-bg: #a7a8bd',
  '--q-gezhi-bold-italic: #f86b1d', '--q-gezhi-reveal-fg: #edc3ae',
  '--q-gezhi-reveal-hover-bg: #525288', '--q-gezhi-table-bg: #b2bbbe',
  '--q-gezhi-divider: #74759b', '--q-gezhi-shell-shadow: 0 4px 6px #13112440',
  '--q-choice-feedback-fg: #c4cbcf', '--q-choice-feedback-bg: #47484c',
  '--q-choice-correct-fg: #b2cf87', '--q-choice-correct-bg: transparent',
  '--q-choice-incorrect-fg: #e77c8e', '--q-choice-incorrect-bg: transparent',
  '--q-choice-incomplete-fg: #e2c17c', '--q-choice-incomplete-bg: transparent'
]) {
  assert(gezhiNightRule.includes(contract), `格致 night missing legacy detail: ${contract}`);
}
const choiceStateTokens = [
  "--q-choice-correct-fg", "--q-choice-correct-bg", "--q-choice-correct-border",
  "--q-choice-incorrect-fg", "--q-choice-incorrect-bg", "--q-choice-incorrect-border",
  "--q-choice-incomplete-fg", "--q-choice-incomplete-bg", "--q-choice-incomplete-border"
];
for (const [mode, themeRule] of [
  ["base", baseThemeRule],
  ["格致 light", gezhiLightRule],
  ["格致 night", gezhiNightRule]
]) {
  const themeTokens = customProperties(themeRule);
  for (const token of choiceStateTokens) {
    assert(themeTokens.has(token), `${mode} theme missing choice state token: ${token}`);
  }
}
for (const [selector, state] of [
  [".option.correct", "correct"],
  [".choice .feedback.correct", "correct"],
  [".option.incorrect", "incorrect"],
  [".choice .feedback.incorrect", "incorrect"],
  [".option.not-selected", "incomplete"],
  [".choice .feedback.incomplete", "incomplete"]
]) {
  const expected = {
    color: `var(--q-choice-${state}-fg)`,
    background: `var(--q-choice-${state}-bg)`,
    "border-color": `var(--q-choice-${state}-border)`
  };
  const matchingRule = rulesContainingSelector(selector).find((rule) =>
    Object.entries(expected).every(
      ([property, value]) => declarationValue(rule, property) === value
    )
  );
  assert(
    matchingRule,
    `${selector} must consume its independent ${state} foreground, background, and border tokens`
  );
}

// These high-specificity state rules must remain after the neutral 格致 option
// and hover rules. Their ordering is what prevents answer feedback from being
// flattened back to the paper-colored default by the cascade.
const gezhiNeutralOptionIndex = reviewSourceCss.lastIndexOf(
  '.container[data-quizify-theme="gezhi"] .option {'
);
const gezhiHoverOptionIndex = reviewSourceCss.lastIndexOf(
  '.container[data-quizify-theme="gezhi"] .option:has(input:not(:disabled)):hover {'
);
for (const selector of [
  '.container[data-quizify-theme="gezhi"] .option.correct,',
  '.container[data-quizify-theme="gezhi"] .option.incorrect,',
  '.container[data-quizify-theme="gezhi"] .option.not-selected,'
]) {
  const stateIndex = reviewSourceCss.lastIndexOf(selector);
  assert(stateIndex > gezhiNeutralOptionIndex, `${selector} must follow the neutral 格致 option rule`);
  assert(stateIndex > gezhiHoverOptionIndex, `${selector} must follow the enabled 格致 hover rule`);
}
for (const selector of [
  ':root[data-quizify-theme="gezhi"]',
  ':host([data-quizify-theme="gezhi"])',
  ':host([data-quizify-theme="gezhi"].nightMode)',
  '.nightMode [data-quizify-theme="gezhi"]',
  '.container[data-quizify-theme="gezhi"].quizify-cardless',
  '.container[data-quizify-theme="gezhi"]:not(.quizify-cardless)',
  '.container[data-quizify-theme="gezhi"] .quizify-card-header',
  '.container[data-quizify-theme="gezhi"] .choice',
  '.container[data-quizify-theme="gezhi"] .markdown-alert-important',
  '.container[data-quizify-theme="gezhi"] ::selection',
  '.container[data-quizify-theme="gezhi"] .annotation',
  '.container[data-quizify-theme="gezhi"] .reveal:not(.active)::after',
  '.container[data-quizify-theme="gezhi"] summary::before',
  '.container[data-quizify-theme="gezhi"] .quizify-table-scroll > table thead'
]) {
  assert(reviewSourceCss.includes(selector), `格致 theme missing scoped selector: ${selector}`);
}
assert(
  ruleFor('.container[data-quizify-theme="gezhi"].quizify-cardless')
    .includes('--q-gezhi-card-gutter: clamp(8px, 2vw, 18px)'),
  "格致 cardless theme must retain the compact preview gutter"
);

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
  'data-quizify-theme="kaiwu"', 'id="visual-theme-toggle"',
  "切换开务", "切换格致"
]) {
  assert(preview.includes(contract), `visual preview missing theme control: ${contract}`);
}

for (const contract of [
  "quizify-tool-button", "--qt-primary-strong",
  ".quizify-command-bar", ".quizify-inspector-panel", ".quizify-live-preview-panel", "prefers-reduced-motion"
]) {
  assert(editorCss.includes(contract) || editorJs.includes(contract), `editor workbench missing: ${contract}`);
}
for (const contract of [
  'setProperty("role", "card")', "内置离线运行时", "校验并重新同步媒体",
  "AnkiDroid 2.24+", "保存并更新模板", "模板主题", "开务", "格致"
]) {
  assert(settings.includes(contract), `settings panel missing: ${contract}`);
}
for (const section of ["Configuration panel", "Editor workbench", "settings-window", "quizify-toolbar-docked", "quizify-inspector-panel", "quizify-live-preview-panel"]) {
  assert(workbench.includes(section), `workbench preview missing: ${section}`);
}

console.log("visual system tests passed");
