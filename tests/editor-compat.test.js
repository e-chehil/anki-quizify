const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const syntax = require("../quizify_addon/web/syntax-tools.js");

function createElement(tagName) {
  function detach(child) {
    if (!child?.parentNode) return;
    const siblings = child.parentNode.children || [];
    const index = siblings.indexOf(child);
    if (index >= 0) siblings.splice(index, 1);
  }

  const element = {
    tagName,
    children: [],
    dataset: {},
    listeners: {},
    className: "",
    textContent: "",
    appendChild(child) {
      detach(child);
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    prepend(child) {
      detach(child);
      child.parentNode = this;
      this.children.unshift(child);
      return child;
    },
    insertBefore(child, reference) {
      detach(child);
      child.parentNode = this;
      const index = reference ? this.children.indexOf(reference) : -1;
      if (index >= 0) {
        this.children.splice(index, 0, child);
      } else {
        this.children.push(child);
      }
      return child;
    },
    after(child) {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children || [];
      const index = siblings.indexOf(this);
      this.parentNode.insertBefore(child, siblings[index + 1] || null);
    },
    replaceChildren(...children) {
      this.children = [];
      for (const child of children) this.appendChild(child);
    },
    setAttribute(name, value) {
      this[name] = value;
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    querySelector(selector) {
      return querySelector(this, selector);
    },
    querySelectorAll(selector) {
      return querySelectorAll(this, selector);
    },
    closest(selector) {
      let node = this;
      while (node) {
        if (matchesSelector(node, selector)) return node;
        node = node.parentNode;
      }
      return null;
    }
  };
  return element;
}

function matchesSelector(element, selector) {
  if (selector === ".field-container[data-index]") {
    return hasClass(element, "field-container") && element.dataset.index !== undefined;
  }
  if (selector.startsWith(".")) return hasClass(element, selector.slice(1));
  return String(element.tagName || "").toLowerCase() === selector.toLowerCase();
}

function querySelectorAll(root, selector) {
  const parts = selector.trim().split(/\s+/);
  let current = [root];

  for (const part of parts) {
    const next = [];
    for (const node of current) {
      collectDescendants(node, part, next);
    }
    current = next;
  }

  return current;
}

function collectDescendants(root, selector, out) {
  for (const child of root.children || []) {
    if (matchesSelector(child, selector)) out.push(child);
    collectDescendants(child, selector, out);
  }
}

function querySelector(root, selector) {
  return querySelectorAll(root, selector)[0] || null;
}

function hasClass(element, className) {
  return String(element.className || "")
    .split(/\s+/)
    .includes(className);
}

function findByClass(element, className) {
  if (hasClass(element, className)) return element;
  for (const child of element.children || []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

const fieldsHost = createElement("div");
fieldsHost.className = "fields";
const noteEditor = createElement("div");
noteEditor.className = "note-editor";
const nativeToolbar = createElement("div");
nativeToolbar.className = "editor-toolbar";
const scrollArea = createElement("div");
scrollArea.className = "scroll-content";
function createField(index, name) {
  const fieldContainer = createElement("div");
  fieldContainer.className = "field-container";
  fieldContainer.dataset.index = String(index);
  const label = createElement("span");
  label.className = "label-name";
  label.textContent = name;
  const codeMirrorNode = createElement("div");
  codeMirrorNode.className = "CodeMirror";
  fieldContainer.appendChild(label);
  fieldContainer.appendChild(codeMirrorNode);
  return { fieldContainer, codeMirrorNode };
}

const frontField = createField(0, "Front");
const backField = createField(1, "Back");

const bodyClasses = new Set();
const body = createElement("body");
body.classList = {
  add(name) {
    bodyClasses.add(name);
  },
  remove(name) {
    bodyClasses.delete(name);
  },
  contains(name) {
    return bodyClasses.has(name);
  }
};
fieldsHost.appendChild(frontField.fieldContainer);
fieldsHost.appendChild(backField.fieldContainer);
scrollArea.appendChild(fieldsHost);
noteEditor.appendChild(nativeToolbar);
noteEditor.appendChild(scrollArea);
body.appendChild(noteEditor);

const document = {
  body,
  baseURI: "https://anki.local/",
  currentScript: null,
  scripts: [
    {
      src: "https://anki.local/_addons/quizify_markdown/web/editor.js?v=test&quizify=1&ntid=42&plain=0%2C1"
    }
  ],
  activeElement: null,
  listeners: {},
  createElement,
  addEventListener(name, listener) {
    this.listeners[name] = listener;
  },
  querySelectorAll(selector) {
    return querySelectorAll(body, selector);
  },
  querySelector(selector) {
    if (selector === ".fields") return fieldsHost;
    if (selector === ".note-editor > .editor-toolbar") return nativeToolbar;
    if (selector === ".editor-toolbar") return nativeToolbar;
    return querySelector(body, selector);
  }
};

function createEditor(initialValue) {
  return {
    value: initialValue,
    selection: "",
    listeners: {},
    replaceSelection(snippet) {
      this.value += snippet;
      this.selection = "";
    },
    getSelection() {
      return this.selection;
    },
    getCursor() {
      return { line: 0, ch: this.value.length };
    },
    setSelection(from, to) {
      this.selectedRange = { from, to };
    },
    focus() {
      document.activeElement = this;
    },
    hasFocus() {
      return document.activeElement === this;
    },
    getValue() {
      return this.value;
    },
    setOption(name, optionValue) {
      this[name] = optionValue;
    },
    on(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    emit(name) {
      for (const listener of this.listeners[name] || []) listener();
    }
  };
}

const frontEditor = createEditor("Front {{answer}}");
const backEditor = createEditor("!audio[clip](sound.mp3)");
frontField.codeMirrorNode.CodeMirror = frontEditor;
backField.codeMirrorNode.CodeMirror = backEditor;

const plainTexts = [{ codeMirror: {} }, { codeMirror: {} }];
const lifecycle = {
  onMount(listener) {
    this.listener = listener;
  }
};

const context = {
  console,
  document,
  URL,
  QuizifySyntax: syntax,
  setNotetypeMeta(metadata) {
    context.notetypeMetadata = metadata;
  },
  setPlainTexts(values) {
    context.plainTextValues = values;
  },
  clearTimeout() {},
  setTimeout(listener) {
    listener();
    return 1;
  },
  require(moduleName) {
    if (moduleName === "anki/ui") return { loaded: Promise.resolve() };
    if (moduleName === "anki/NoteEditor") {
      return {
        instances: [{
          fields: Promise.resolve([
            { name: "Front", plainText: true },
            { name: "Back", plainText: true },
            { name: "Extra", plainText: false }
          ])
        }]
      };
    }
    if (moduleName === "anki/PlainTextInput") {
      return { lifecycle, instances: plainTexts };
    }
    throw new Error(`Unexpected module: ${moduleName}`);
  }
};
context.globalThis = context;

const source = fs.readFileSync(
  path.join(__dirname, "../quizify_addon/web/editor.js"),
  "utf8"
);
const nativeSetPlainTexts = context.setPlainTexts;
vm.runInNewContext(source, context);
context.setNotetypeMeta({ id: "42", modTime: 7 });
context.setPlainTexts([true, true, false]);

context.quizifyEditorActivate().then(async () => {
  assert.equal(body.classList.contains("quizify-editor-active"), true);
  assert.deepEqual(Array.from(context.plainTextValues), [true, true, false]);
  assert.notEqual(context.setPlainTexts, nativeSetPlainTexts);
  assert.equal(context.setPlainTexts.__quizifyPlainTextPolicy, true);
  context.setPlainTexts([false, false, true]);
  assert.deepEqual(Array.from(context.plainTextValues), [true, true, true]);
  context.setPlainTexts([true, true, false]);
  assert.equal(frontEditor.lineWrapping, true);
  assert.equal(backEditor.lineWrapping, true);
  assert(frontEditor.listeners.change.length);
  assert(frontEditor.listeners.focus.length);

  const toolbar = document.querySelector(".quizify-toolbar");
  assert(toolbar);
  assert.equal(toolbar.parentNode, noteEditor);
  assert.equal(noteEditor.children[0], nativeToolbar);
  assert.equal(noteEditor.children[1], toolbar);
  assert(hasClass(toolbar, "quizify-toolbar-docked"));
  assert.equal(toolbar.dataset.docked, "native");
  const commandBar = findByClass(toolbar, "quizify-command-bar");
  assert(commandBar);
  assert.equal(findByClass(toolbar, "quizify-more-menu"), null);
  assert.equal(findByClass(toolbar, "quizify-insert-menu"), null);
  assert.equal(findByClass(toolbar, "quizify-toolbar-brand"), null);
  assert.equal(findByClass(toolbar, "quizify-command-section"), null);
  assert.equal(findByClass(toolbar, "quizify-direct-actions"), null);
  assert.equal(
    querySelectorAll(toolbar, ".quizify-markdown-button").length,
    syntax.markdownActions.length
  );
  assert.equal(
    querySelectorAll(toolbar, ".quizify-snippet-button").length,
    syntax.snippets.length
  );
  assert(findByClass(toolbar, "quizify-preview-menu"));
  assert(findByClass(toolbar, "quizify-live-preview-panel"));
  assert(findByClass(toolbar, "quizify-inspector-panel"));
  assert.equal(commandBar.children.length, syntax.markdownActions.length + syntax.snippets.length + 2);
  assert(commandBar.children.slice(0, -2).every((item) => hasClass(item, "quizify-tool-button")));
  assert(hasClass(commandBar.children.at(-2).children[0], "quizify-tool-button"));
  assert(hasClass(commandBar.children.at(-1).children[0], "quizify-tool-button"));
  assert(hasClass(commandBar.children.at(-1), "quizify-preview-menu"));
  assert.equal(toolbar.role, "toolbar");
  await context.quizifyEditorActivate();
  assert.equal(noteEditor.children[1], toolbar);
  assert.match(toolbar["aria-label"], /Front/);
  assert.match(findByClass(toolbar, "quizify-command-summary")["aria-label"], /Front/);

  const insertFillBlank = findByClass(toolbar, "quizify-snippet-button");
  assert(insertFillBlank);
  assert.equal(insertFillBlank.dataset.shortcut, "Ctrl+Alt+1");
  assert.equal(insertFillBlank["aria-keyshortcuts"], "Control+Alt+1");
  let prevented = false;
  insertFillBlank.listeners.mousedown({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.doesNotThrow(() =>
    insertFillBlank.listeners.click({ preventDefault() {} })
  );
  assert.equal(frontEditor.value, "Front {{answer}}{{答案}}");
  assert.equal(frontEditor.selectedRange.to.ch - frontEditor.selectedRange.from.ch, 2);

  const markdownBold = findByClass(toolbar, "quizify-markdown-button");
  assert(markdownBold);
  assert.equal(markdownBold.dataset.action, "bold");
  assert.equal(markdownBold["aria-keyshortcuts"], "Control+B");
  frontEditor.selection = "关键";
  markdownBold.listeners.click({ preventDefault() {} });
  assert.match(frontEditor.value, /\*\*关键\*\*$/);
  assert.equal(frontEditor.selectedRange.to.ch - frontEditor.selectedRange.from.ch, 2);

  frontEditor.selection = "术语";
  let markdownShortcutPrevented = false;
  document.listeners.keydown({
    target: frontField.codeMirrorNode,
    key: "i",
    code: "KeyI",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {
      markdownShortcutPrevented = true;
    },
    stopPropagation() {}
  });
  assert.equal(markdownShortcutPrevented, true);
  assert.match(frontEditor.value, /\*术语\*$/);

  const beforeOutsideShortcut = frontEditor.value;
  let outsideShortcutPrevented = false;
  document.listeners.keydown({
    target: nativeToolbar,
    key: "b",
    code: "KeyB",
    ctrlKey: true,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    preventDefault() {
      outsideShortcutPrevented = true;
    },
    stopPropagation() {}
  });
  assert.equal(outsideShortcutPrevented, false);
  assert.equal(frontEditor.value, beforeOutsideShortcut);

  const preview = document.querySelector(".quizify-preview-list");
  assert(preview.children.some((child) => child.dataset.kind === "fitb"));
  assert(!preview.children.some((child) => child.dataset.kind === "audio"));

  frontEditor.value = Array.from({ length: 26 }, (_, index) => `{{答案${index + 1}}}`).join("\n");
  frontEditor.focus();
  frontEditor.emit("focus");
  frontEditor.emit("change");
  assert.equal(preview.children.filter((child) => child.dataset.kind === "fitb").length, 26);
  assert(!preview.children.some((child) => /未显示/.test(child.textContent)));

  backEditor.focus();
  backEditor.emit("focus");
  assert.match(toolbar["aria-label"], /Back/);
  assert.match(findByClass(toolbar, "quizify-command-summary")["aria-label"], /Back/);
  assert(preview.children.some((child) => child.dataset.kind === "audio"));
  assert(!preview.children.some((child) => child.dataset.kind === "fitb"));

  let shortcutPrevented = false;
  document.listeners.keydown({
    target: backField.codeMirrorNode,
    key: "1",
    code: "Digit1",
    ctrlKey: true,
    altKey: true,
    shiftKey: false,
    metaKey: false,
    preventDefault() {
      shortcutPrevented = true;
    },
    stopPropagation() {}
  });
  assert.equal(shortcutPrevented, true);
  assert.match(backEditor.value, /\{\{答案\}\}$/);

  fieldsHost.prepend(toolbar);
  assert.equal(toolbar.parentNode, fieldsHost);
  await context.quizifyEditorActivate();
  assert.equal(toolbar.parentNode, noteEditor);
  assert.equal(noteEditor.children[1], toolbar);
  assert(hasClass(toolbar, "quizify-toolbar-docked"));

  const beforeDeactivate = backEditor.value;
  await context.quizifyEditorDeactivate();
  assert.equal(body.classList.contains("quizify-editor-active"), false);
  assert.equal(toolbar.hidden, true);
  insertFillBlank.listeners.click({ preventDefault() {} });
  assert.equal(backEditor.value, beforeDeactivate);
  assert.deepEqual(Array.from(context.plainTextValues), [true, true, false]);

  const staleActivation = context.quizifyEditorActivate();
  const winningDeactivation = context.quizifyEditorDeactivate();
  assert.deepEqual(await Promise.all([staleActivation, winningDeactivation]), [false, true]);
  assert.equal(body.classList.contains("quizify-editor-active"), false);
  assert.equal(toolbar.hidden, true);

  const staleDeactivation = context.quizifyEditorDeactivate();
  const winningActivation = context.quizifyEditorActivate();
  assert.deepEqual(await Promise.all([staleDeactivation, winningActivation]), [true, true]);
  assert.equal(body.classList.contains("quizify-editor-active"), true);
  assert.equal(toolbar.hidden, false);

  console.log("editor compatibility tests passed");
});
