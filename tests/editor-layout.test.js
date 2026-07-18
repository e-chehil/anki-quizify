const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(
  path.join(__dirname, "../src/editor/styles.css"),
  "utf8"
);

function selectorBodies(selector, source = css) {
  const bodies = [];
  const sanitized = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (let match = rulePattern.exec(sanitized); match; match = rulePattern.exec(sanitized)) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

function selectorBody(selector, source = css) {
  const bodies = selectorBodies(selector, source);
  assert(bodies.length, `missing stylesheet rule for ${selector}`);
  return bodies[0];
}

const toolbar = selectorBody(".quizify-toolbar");
const dockedToolbar = selectorBody(".quizify-toolbar-docked");
const commandBar = selectorBody(".quizify-command-bar");
const toolButton = selectorBody(".quizify-tool-button");

for (const [property, pattern, message] of [
  ["background", /background:\s*transparent;/, "toolbar background must be transparent"],
  ["border", /border:\s*0;/, "toolbar must not draw a card border"],
  ["border radius", /border-radius:\s*0;/, "toolbar must not look like a rounded card"],
  ["shadow", /box-shadow:\s*none;/, "toolbar must not cast a panel shadow"]
]) {
  assert.match(toolbar, pattern, `${property}: ${message}`);
}

assert.match(dockedToolbar, /background:\s*transparent;/);
assert.match(dockedToolbar, /border:\s*0;/);
assert.match(dockedToolbar, /border-radius:\s*0;/);
assert.match(dockedToolbar, /box-shadow:\s*none;/);
assert.match(dockedToolbar, /overflow:\s*visible;/, "floating panels must not be clipped");
assert.doesNotMatch(
  dockedToolbar,
  /position:\s*sticky/,
  "Quizify must not stick over Anki's native toolbar"
);

const accentBodies = selectorBodies(".quizify-toolbar::before");
assert(
  accentBodies.length === 0 || accentBodies.every((body) => /display:\s*none;/.test(body)),
  "the retired decorative card accent must be removed or disabled"
);

assert.match(commandBar, /align-items:\s*center;/);
assert.match(commandBar, /display:\s*flex;/);
assert.match(
  commandBar,
  /flex-wrap:\s*wrap;/,
  "all command buttons must wrap naturally at the actual editor width"
);
assert.match(commandBar, /inline-size:\s*100%;/);
assert.match(commandBar, /min-inline-size:\s*0;/);
assert.match(commandBar, /overflow:\s*visible;/);
assert.match(commandBar, /white-space:\s*normal;/);
assert.match(commandBar, /background:\s*transparent;/);
assert.match(commandBar, /border:\s*0;/);

for (const body of selectorBodies(".quizify-command-bar")) {
  assert.doesNotMatch(
    body,
    /overflow(?:-x)?:\s*(?:auto|scroll|hidden|clip)/,
    "the command flow must never scroll or clip buttons"
  );
  assert.doesNotMatch(
    body,
    /flex-wrap:\s*nowrap/,
    "no breakpoint may restore a forced single command track"
  );
  assert.doesNotMatch(
    body,
    /max-(?:block-size|height):/,
    "the command flow must remain usable however many rows it needs"
  );
}

assert.match(toolButton, /display:\s*inline-flex;/);
assert.match(
  toolButton,
  /(?:inline-size|width):\s*(?!auto)[^;]+;/,
  "the common control class must own one fixed inline size"
);
assert.match(
  toolButton,
  /min-(?:inline-size|width):\s*(?!0(?:px)?;)[^;]+;/,
  "the common control class must prevent utility labels from widening controls"
);
assert.match(
  toolButton,
  /(?:block-size|height):\s*(?!auto)[^;]+;/,
  "the common control class must own one fixed block size"
);
assert.match(toolButton, /flex:\s*0\s+0\s+[^;]+;/);

for (const selector of [
  ".quizify-markdown-button",
  ".quizify-snippet-button",
  ".quizify-command-summary",
  ".quizify-diagnostics-status"
]) {
  for (const body of selectorBodies(selector)) {
    assert.doesNotMatch(
      body,
      /(?:^|\s)(?:min-|max-)?(?:inline-size|block-size|width|height)\s*:/,
      `${selector} must not override the shared tool-button dimensions`
    );
    assert.doesNotMatch(
      body,
      /display:\s*none|visibility:\s*hidden/,
      `${selector} must remain reachable even in an extremely narrow editor`
    );
  }
}

for (const retiredSelector of [
  ".quizify-toolbar-header",
  ".quizify-toolbar-brand",
  ".quizify-toolbar-logo",
  ".quizify-toolbar-title",
  ".quizify-toolbar-eyebrow",
  ".quizify-active-field",
  ".quizify-command-section",
  ".quizify-markdown-actions",
  ".quizify-direct-actions"
]) {
  assert.equal(
    selectorBodies(retiredSelector).length,
    0,
    `${retiredSelector} must not leave a hidden layout track behind`
  );
}

assert.doesNotMatch(
  css,
  /quizify-(?:more-menu|insert-menu|markdown-more)|\.quizify-command-panel\.quizify-toolbar-actions/,
  "retired insertion submenus must not return"
);
assert.doesNotMatch(
  css,
  /\.quizify-command-bar[^{}]*\{[^}]*grid-template-(?:columns|rows)/,
  "responsive behavior must not depend on fixed command grids"
);
assert.match(css, /\.quizify-toolbar,\s*\.quizify-toolbar \*\s*\{[\s\S]*?box-sizing: border-box;/);
assert.match(
  css,
  /\.quizify-live-preview-panel\s*\{[\s\S]*?width:\s*min\(820px,[\s\S]*?max-height:/,
  "live preview should keep its spacious floating panel"
);
assert.match(css, /\.quizify-rendered-preview-header\s*\{/);
assert.match(css, /\.quizify-rendered-preview-host\s*\{[\s\S]*?min-height:\s*150px/);
assert.match(
  css,
  /\.quizify-panel-portal\s*\{[\s\S]*?z-index:\s*10000\s*!important/,
  "open panels must escape editor overflow clipping"
);
assert.doesNotMatch(
  css,
  /:has\([^}]*\.rich-text-input|\.rich-text-input[^}]*clip-path\s*:\s*inset/,
  "Quizify must never hide Anki's rich editor before plain mode is confirmed"
);
assert.doesNotMatch(
  css,
  /\.plain-text-badge\s*\{[^}]*display\s*:\s*none/,
  "the native plain/rich mode control must remain available as a recovery path"
);
assert.doesNotMatch(
  css,
  /\.quizify-editor-active\s+(?:\.CodeMirror|\.cm-editor|\.cm-line)/,
  "Quizify must not restyle Anki's native CodeMirror editing surface"
);
assert.equal(
  (css.match(/\{/g) || []).length,
  (css.match(/\}/g) || []).length,
  "editor stylesheet braces must stay balanced"
);

console.log("editor flat-toolbar layout tests passed");
