import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

function editor(initialValue) {
  return {
    focused: false,
    value: initialValue,
    selection: "",
    listeners: {},
    focus() {
      this.focused = true;
    },
    getCursor() {
      return { line: 0, ch: this.value.length };
    },
    getSelection() {
      return this.selection;
    },
    getValue() {
      return this.value;
    },
    hasFocus() {
      return this.focused;
    },
    on(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    replaceSelection(value) {
      this.value += value;
    },
    setOption() {},
    setSelection() {}
  };
}

test("real DOM toolbar keeps native fields visible and scopes plain text and shortcuts", async () => {
  const dom = new JSDOM(`<!doctype html><head>
    <script src="https://anki.local/_addons/quizify_markdown/web/editor.js?v=test&quizify=1&ntid=1234567890123456789&plain=0%2C1"></script>
  </head><body>
    <div class="note-editor">
      <div class="editor-toolbar"><button id="outside">Native</button></div>
      <div class="fields">
        <div class="field-container" data-index="0"><span class="label-name">Front</span><span class="plain-text-badge"><button type="button">HTML</button></span><div class="collapsible"><div class="rich-text-input"></div></div><div class="collapsible hidden" hidden><div class="plain-text-input" hidden><div class="code-mirror"><textarea id="front-input" hidden></textarea></div></div></div></div>
        <div class="field-container" data-index="1"><span class="label-name">Back</span><span class="plain-text-badge"><button type="button">HTML</button></span><div class="collapsible"><div class="rich-text-input"></div></div><div class="collapsible hidden" hidden><div class="plain-text-input" hidden><div class="code-mirror"><textarea id="back-input" hidden></textarea></div></div></div></div>
        <div class="field-container" data-index="2"><span class="label-name">Extra</span><span class="plain-text-badge"><button type="button">HTML</button></span><div class="collapsible"><div class="rich-text-input"></div></div><div class="collapsible hidden" hidden><div class="plain-text-input" hidden><div class="code-mirror"><textarea id="extra-input" hidden></textarea></div></div></div></div>
      </div>
    </div>
  </body>`, { pretendToBeVisual: true });

  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = dom.window.MutationObserver;
  const front = editor("Front");
  const back = editor("Back");
  const extra = editor("Extra");
  const editors = [front, back, extra];
  const nativeToggleClicks = [0, 0, 0];
  const componentToggleCalls = [0, 0, 0];

  function setPlainVisible(container, index, visible) {
    const plain = container.querySelector(".plain-text-input");
    const wrapper = plain.parentElement;
    if (visible && !plain.querySelector(".CodeMirror, .cm-editor")) {
      const editorNode = document.createElement("div");
      editorNode.className = index === 0 ? "cm-editor" : "CodeMirror";
      editorNode.CodeMirror = editors[index];
      plain.querySelector(".code-mirror").append(editorNode);
    }
    plain.hidden = !visible;
    wrapper.hidden = !visible;
    wrapper.classList.toggle("hidden", !visible);
  }

  document.querySelectorAll(".field-container").forEach((container, index) => {
    container.querySelector(".plain-text-badge button").addEventListener("click", () => {
      nativeToggleClicks[index] += 1;
      const plain = container.querySelector(".plain-text-input");
      setPlainVisible(container, index, plain.hidden);
      container.querySelector("textarea").focus();
    });
  });

  const containers = [...document.querySelectorAll(".field-container")];
  const plainTextInputs = editors.map((codeMirror, index) => ({
    codeMirror,
    toggle() {
      componentToggleCalls[index] += 1;
      const plain = containers[index].querySelector(".plain-text-input");
      setPlainVisible(containers[index], index, plain.hidden);
      return !plain.hidden;
    }
  }));
  const noteEditor = {
    fields: Promise.resolve([
      { name: "Front", plainText: true },
      { name: "Back", plainText: true },
      { name: "Extra", plainText: false }
    ])
  };
  const lifecycle = { onMount(listener) { this.listener = listener; } };
  const plainTextCalls = [];
  const notetypeMetaCalls = [];
  let cachedFieldStates = {
    modTime: 42,
    plainTexts: [false, false, false]
  };
  globalThis.setNotetypeMeta = (metadata) => {
    notetypeMetaCalls.push({ ...metadata });
    if (cachedFieldStates?.modTime !== metadata.modTime) cachedFieldStates = null;
  };
  const nativeSetPlainTexts = (values) => {
    plainTextCalls.push(Array.from(values));
    const visibleValues = cachedFieldStates?.plainTexts || values;
    visibleValues.forEach((visible, index) =>
      setPlainVisible(containers[index], index, visible)
    );
  };
  globalThis.setPlainTexts = nativeSetPlainTexts;
  globalThis.require = (name) => {
    if (name === "anki/ui") return { loaded: Promise.resolve() };
    if (name === "anki/NoteEditor") return { instances: [noteEditor] };
    if (name === "anki/PlainTextInput") {
      return { lifecycle, instances: plainTextInputs };
    }
    throw new Error(name);
  };
  await import(`../src/shared/syntax-tools.js?toolbar-dom=${Date.now()}`);
  const snippetFixtures = globalThis.QuizifySyntax.snippets;
  const markdownFixtures = globalThis.QuizifySyntax.markdownActions;
  assert.equal(markdownFixtures.length, 16, "the production toolbar needs all Markdown actions");
  assert.equal(snippetFixtures.length, 8, "the production toolbar needs all Quizify actions");

  document.querySelector("#outside").focus();
  await import(`../src/editor/legacy-editor.js?dom-test=${Date.now()}`);
  globalThis.setNotetypeMeta({ id: "1234567890123456789", modTime: 42 });
  globalThis.setPlainTexts([true, true, false]);
  assert.equal(await globalThis.quizifyEditorActivate(), true);
  await new Promise((resolve) => setTimeout(resolve, 140));

  assert.equal(document.querySelectorAll(".rich-text-input").length, 3);
  assert.equal(document.querySelector(".quizify-toolbar").hidden, false);
  const fieldContainers = [...document.querySelectorAll(".field-container")];
  assert.equal(fieldContainers[0].querySelector(".plain-text-input").hidden, false);
  assert.equal(fieldContainers[1].querySelector(".plain-text-input").hidden, false);
  assert.equal(fieldContainers[2].querySelector(".plain-text-input").hidden, true);
  assert.deepEqual(plainTextCalls.at(-1), [true, true, false]);
  assert.deepEqual(notetypeMetaCalls, [
    { id: "1234567890123456789", modTime: 42 },
    { id: "1234567890123456789", modTime: "quizify:42:1" },
    { id: "1234567890123456789", modTime: 42 }
  ]);
  assert.deepEqual(nativeToggleClicks, [0, 0, 0]);
  assert.deepEqual(componentToggleCalls, [0, 0, 0]);
  assert.equal(document.activeElement?.id, "outside");
  assert.notEqual(globalThis.setPlainTexts, nativeSetPlainTexts);
  assert.equal(globalThis.setPlainTexts.__quizifyPlainTextPolicy, true);

  assert.equal(await globalThis.quizifyEditorActivate(), true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(notetypeMetaCalls.length, 3, "activation must not remount native fields");
  assert.deepEqual(componentToggleCalls, [0, 0, 0]);
  assert.deepEqual(nativeToggleClicks, [0, 0, 0]);
  assert.equal(document.activeElement?.id, "outside");

  const outsideEvent = new dom.window.KeyboardEvent("keydown", {
    key: "b",
    code: "KeyB",
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  document.querySelector("#outside").dispatchEvent(outsideEvent);
  assert.equal(outsideEvent.defaultPrevented, false);
  assert.equal(front.value, "Front");

  front.focus();
  const fieldEvent = new dom.window.KeyboardEvent("keydown", {
    key: "b",
    code: "KeyB",
    ctrlKey: true,
    bubbles: true,
    cancelable: true
  });
  document.querySelector("#front-input").dispatchEvent(fieldEvent);
  assert.equal(fieldEvent.defaultPrevented, true);
  assert.equal(front.value, "Front**粗体**");

  assert.equal(document.querySelector(".quizify-more-menu"), null);
  assert.equal(document.querySelector(".quizify-insert-menu"), null);
  assert.equal(document.querySelectorAll(".quizify-markdown-button").length, 16);
  assert.equal(
    document.querySelectorAll(".quizify-snippet-button").length,
    snippetFixtures.length
  );

  const toolbar = document.querySelector(".quizify-toolbar");
  const commandBar = document.querySelector(".quizify-command-bar");
  const directCommandChildren = [...commandBar.children];
  const directMarkdown = directCommandChildren.filter((item) =>
    item.classList.contains("quizify-markdown-button")
  );
  const directSnippets = directCommandChildren.filter((item) =>
    item.classList.contains("quizify-snippet-button")
  );
  const directInspector = commandBar.querySelector(":scope > .quizify-inspector");
  const directPreview = commandBar.querySelector(":scope > .quizify-preview-menu");

  assert.equal(toolbar.querySelector(":scope > .quizify-command-bar"), commandBar);
  assert.equal(toolbar.getAttribute("role"), "toolbar");
  assert.match(toolbar.getAttribute("aria-label"), /Quizify/);
  for (const retiredSelector of [
    ".quizify-toolbar-header",
    ".quizify-toolbar-brand",
    ".quizify-command-section",
    ".quizify-markdown-actions",
    ".quizify-direct-actions"
  ]) {
    assert.equal(
      toolbar.querySelector(retiredSelector),
      null,
      `${retiredSelector} must not create another layout panel or wrapping boundary`
    );
  }
  assert.equal(directMarkdown.length, markdownFixtures.length);
  assert.equal(directSnippets.length, snippetFixtures.length);
  assert(directInspector, "diagnostics must be a direct item in the flat button flow");
  assert(directPreview, "rendering must be a direct item in the flat button flow");
  assert.equal(
    directCommandChildren.length,
    markdownFixtures.length + snippetFixtures.length + 2,
    "the flat command flow must contain only 24 authoring buttons and two utilities"
  );
  assert.deepEqual(
    directCommandChildren.slice(0, markdownFixtures.length),
    directMarkdown,
    "all 16 Markdown controls must lead the visual and keyboard order"
  );
  assert.deepEqual(
    directCommandChildren.slice(markdownFixtures.length, markdownFixtures.length + snippetFixtures.length),
    directSnippets,
    "all eight Quizify controls must follow the Markdown controls"
  );
  assert.equal(directCommandChildren.at(-2), directInspector);
  assert.equal(
    directCommandChildren.at(-1),
    directPreview,
    "render must be the final visual and Tab-order item at every wrapped width"
  );

  const visualControls = [
    ...directMarkdown,
    ...directSnippets,
    directInspector.querySelector("summary"),
    directPreview.querySelector("summary")
  ];
  assert.equal(visualControls.length, 26);
  visualControls.forEach((control) => {
    assert(control.classList.contains("quizify-tool-button"));
    assert.match(
      control.getAttribute("aria-label") || control.textContent.trim(),
      /\S/,
      "every icon control needs an accessible name"
    );
    assert.match(control.title, /\S/);
    const icons = control.querySelectorAll(":scope > svg.quizify-command-icon");
    assert.equal(icons.length, 1, "every editor control must render one direct SVG icon");
    assert.equal(icons[0].getAttribute("aria-hidden"), "true");
  });
  assert.equal(toolbar.querySelector(".quizify-markdown-symbol"), null);
  assert.equal(toolbar.querySelector(".quizify-snippet-symbol"), null);
  assert.doesNotMatch(
    visualControls.map((control) => control.textContent).join(""),
    /⛓|❞|•≡|1≡|▧|▦|◉|↯|※|▾|▤|♪|◐|✓|×/u,
    "retired font glyphs must not leak back into the icon controls"
  );

  const snippetButtons = [...document.querySelectorAll(".quizify-snippet-button")];
  snippetButtons.forEach((button, index) => {
    const [label] = snippetFixtures[index];
    const icon = button.querySelector(".quizify-snippet-icon");
    assert.equal(icon?.tagName.toLowerCase(), "svg", `${label} should use a semantic SVG icon`);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.match(button.title, new RegExp(`^${label} \\(`));
    assert.match(button.getAttribute("aria-label"), new RegExp(`^${label}`));
    assert.equal(
      button.querySelector(".quizify-snippet-label"),
      null,
      `${label}'s full visible label would make the command strip too wide`
    );
  });

  front.selection = "保留选区";
  const strike = document.querySelector('[data-action="strikethrough"]');
  const down = new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true
  });
  strike.dispatchEvent(down);
  assert.equal(down.defaultPrevented, true, "toolbar pointer use must not steal editor focus");
  strike.click();
  assert.equal(front.value, "Front**粗体**~~保留选区~~");

  const snippet = document.querySelector(".quizify-snippet-button");
  snippet.dispatchEvent(new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true
  }));
  snippet.click();
  assert.equal(front.value, "Front**粗体**~~保留选区~~{{答案}}");

  const diagnosticsSummary = directInspector.querySelector("summary");
  front.focused = false;
  back.focused = true;
  back.selection = "诊断前选区";
  const diagnosticsDown = new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true
  });
  diagnosticsSummary.dispatchEvent(diagnosticsDown);
  assert.equal(
    diagnosticsDown.defaultPrevented,
    true,
    "opening diagnostics with a pointer must not steal the editor selection"
  );
  back.focused = false;
  front.focused = true;
  const frontBeforeDiagnosticsContextCheck = front.value;
  document.querySelector('[data-action="bold"]').click();
  assert.equal(back.value, "Back**诊断前选区**");
  assert.equal(
    front.value,
    frontBeforeDiagnosticsContextCheck,
    "diagnostics must retain the field context captured on pointer down"
  );

  const previewMenu = document.querySelector(".quizify-preview-menu");
  const previewSummary = previewMenu.querySelector("summary");
  front.focused = false;
  back.focused = true;
  back.selection = "预览前选区";
  const previewDown = new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true
  });
  previewSummary.dispatchEvent(previewDown);
  assert.equal(
    previewDown.defaultPrevented,
    true,
    "opening render preview with a pointer must not steal the editor selection"
  );
  back.focused = false;
  front.focused = true;
  const frontBeforePreviewContextCheck = front.value;
  document.querySelector('[data-action="bold"]').click();
  assert.equal(back.value, "Back**诊断前选区****预览前选区**");
  assert.equal(
    front.value,
    frontBeforePreviewContextCheck,
    "render preview must retain the field context captured on pointer down"
  );

  previewSummary.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true
  }));
  previewMenu.open = true;
  previewMenu.dispatchEvent(new dom.window.Event("toggle"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(previewSummary.getAttribute("aria-expanded"), "true");

  const escape = new dom.window.KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true
  });
  document.activeElement.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(previewMenu.open, false);
  assert.equal(document.activeElement, previewSummary);

  front.value = "&gt; [!NOTE]\n&gt; 提示内容";
  assert.equal(
    globalThis.quizifyEditorCurrentField().value,
    "> [!NOTE]\n> 提示内容",
    "editor preview must receive decoded Markdown rather than Anki HTML entities"
  );

  const diagnosticsSummaryBeforeError = document.querySelector(".quizify-diagnostics-status");
  const okIcon = diagnosticsSummaryBeforeError.querySelector("svg");
  front.value = "[[missing separator]]";
  for (const listener of front.listeners.change || []) listener();
  await new Promise((resolve) => setTimeout(resolve, 140));
  const diagnosticsSummaryAfterError = document.querySelector(".quizify-diagnostics-status");
  const errorIcon = diagnosticsSummaryAfterError.querySelector("svg");
  assert.equal(diagnosticsSummaryAfterError.dataset.state, "error");
  assert.notEqual(errorIcon, okIcon, "diagnostic state changes must replace the SVG icon");
  assert.equal(errorIcon.getAttribute("aria-hidden"), "true");
  assert.match(diagnosticsSummaryAfterError.getAttribute("aria-label"), /\S/);

  noteEditor.fields = Promise.resolve([{ name: "Text", plainText: false }]);
  assert.equal(await globalThis.quizifyEditorDeactivate(), true);
  assert.equal(document.querySelector(".quizify-toolbar").hidden, true);
  assert.equal(globalThis.setPlainTexts.__quizifyPlainTextPolicy, true);
});
