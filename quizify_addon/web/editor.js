(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/editor/runtime-config.js
  function scriptUrl(script) {
    try {
      return (script == null ? void 0 : script.src) ? new URL(script.src, document.baseURI) : null;
    } catch {
      return null;
    }
  }
  function isEditorBundle(url) {
    return Boolean(url && /\/web\/editor\.js$/.test(url.pathname));
  }
  function locateEditorBundle() {
    const current = scriptUrl(document.currentScript);
    if (isEditorBundle(current)) return current;
    const candidates = Array.from(document.scripts || []).map(scriptUrl).filter(isEditorBundle);
    const marked = candidates.find((url) => url.searchParams.get("quizify") === "1");
    if (marked) return marked;
    return candidates.length === 1 ? candidates[0] : null;
  }
  var editorBundleUrl = locateEditorBundle();
  var quizifyNotetypeId = (editorBundleUrl == null ? void 0 : editorBundleUrl.searchParams.get("ntid")) || "";
  var quizifyPlainTextIndices = new Set(
    ((editorBundleUrl == null ? void 0 : editorBundleUrl.searchParams.get("plain")) || "").split(",").map((value) => Number.parseInt(value, 10)).filter(Number.isInteger)
  );

  // src/editor/preview-loader.js
  var previewPromise = null;
  function previewBundleUrl() {
    if (!editorBundleUrl) return null;
    const previewUrl = new URL("editor-preview.js", editorBundleUrl);
    previewUrl.search = editorBundleUrl.search;
    return previewUrl.href;
  }
  globalThis.quizifyLoadEditorPreview = () => {
    if (globalThis.quizifyEditorPreviewReady) return Promise.resolve(true);
    if (previewPromise) return previewPromise;
    const source = previewBundleUrl();
    if (!source) return Promise.reject(new Error("\u627E\u4E0D\u5230 Quizify \u9884\u89C8\u8D44\u6E90\u5730\u5740"));
    previewPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = source;
      script.async = true;
      script.addEventListener("load", () => resolve(true), { once: true });
      script.addEventListener("error", () => {
        previewPromise = null;
        reject(new Error("Quizify \u9884\u89C8\u8D44\u6E90\u52A0\u8F7D\u5931\u8D25"));
      }, { once: true });
      document.head.appendChild(script);
    });
    return previewPromise;
  };

  // src/editor/anki-adapter.js
  function loadAnkiEditorAdapter(target = globalThis) {
    var _a, _b;
    const requireModule = typeof target.require === "function" ? target.require.bind(target) : typeof __require !== "undefined" ? __require : null;
    if (!requireModule) return null;
    try {
      const { loaded } = requireModule("anki/ui");
      const { instances: noteEditors } = requireModule("anki/NoteEditor");
      const {
        lifecycle: plainTextLifecycle,
        instances: plainTextInputs
      } = requireModule("anki/PlainTextInput");
      return Object.freeze({
        loaded,
        noteEditors,
        plainTextInputs,
        plainTextLifecycle
      });
    } catch (error) {
      (_b = (_a = target.console) == null ? void 0 : _a.warn) == null ? void 0 : _b.call(_a, "Quizify editor API is unavailable", error);
      return null;
    }
  }

  // src/editor/floating-panels.js
  var TOOLBAR_THEME_VARIABLES = [
    "--qt-surface",
    "--qt-surface-soft",
    "--qt-surface-raised",
    "--qt-text",
    "--qt-muted",
    "--qt-border",
    "--qt-border-strong",
    "--qt-primary",
    "--qt-primary-strong",
    "--qt-primary-soft",
    "--qt-accent",
    "--qt-blue",
    "--qt-green",
    "--qt-purple",
    "--qt-amber",
    "--qt-red",
    "--qt-shadow"
  ];
  function hasClassName(element, name) {
    return String((element == null ? void 0 : element.className) || "").split(/\s+/).includes(name);
  }
  function addClassName(element, name) {
    if (!element || hasClassName(element, name)) return;
    element.className = `${element.className || ""} ${name}`.trim();
  }
  function removeClassName(element, name) {
    if (!element) return;
    element.className = String(element.className || "").split(/\s+/).filter((item) => item && item !== name).join(" ");
  }
  function createFloatingPanelManager(root = globalThis, documentRef = document) {
    const registrations = /* @__PURE__ */ new Set();
    let eventsBound = false;
    function close(owner) {
      var _a, _b, _c;
      if (!owner) return;
      owner.open = false;
      const registration = Array.from(registrations).find((item) => item.owner === owner);
      const panel = registration == null ? void 0 : registration.panel;
      (_c = (_b = (_a = owner.querySelector) == null ? void 0 : _a.call(owner, "summary")) == null ? void 0 : _b.setAttribute) == null ? void 0 : _c.call(_b, "aria-expanded", "false");
      if (!panel) return;
      panel.hidden = true;
      removeClassName(panel, "quizify-panel-portal");
      if (owner.appendChild && panel.parentNode !== owner) owner.appendChild(panel);
    }
    function closeTop(focusAnchor = false) {
      var _a, _b, _c, _d;
      const registration = Array.from(registrations).filter(({ owner }) => owner.open).at(-1);
      if (!registration) return false;
      close(registration.owner);
      if (focusAnchor) (_d = (_c = (_b = (_a = registration.owner).querySelector) == null ? void 0 : _b.call(_a, "summary")) == null ? void 0 : _c.focus) == null ? void 0 : _d.call(_c);
      return true;
    }
    function position(owner, panel, preferredWidth) {
      var _a, _b, _c, _d, _e;
      const anchor = (_a = owner == null ? void 0 : owner.querySelector) == null ? void 0 : _a.call(owner, "summary");
      if (!(anchor == null ? void 0 : anchor.getBoundingClientRect) || !(panel == null ? void 0 : panel.style)) return;
      if (owner.isConnected === false) {
        close(owner);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const toolbar = (_b = owner.closest) == null ? void 0 : _b.call(owner, ".quizify-toolbar");
      const toolbarStyle = toolbar && ((_c = root.getComputedStyle) == null ? void 0 : _c.call(root, toolbar));
      if (toolbarStyle) {
        TOOLBAR_THEME_VARIABLES.forEach((name) => {
          panel.style.setProperty(name, toolbarStyle.getPropertyValue(name));
        });
        panel.style.fontFamily = toolbarStyle.fontFamily;
        panel.style.colorScheme = toolbarStyle.colorScheme;
      }
      const viewportWidth = ((_d = documentRef.documentElement) == null ? void 0 : _d.clientWidth) || root.innerWidth || 320;
      const viewportHeight = ((_e = documentRef.documentElement) == null ? void 0 : _e.clientHeight) || root.innerHeight || 320;
      const margin = 8;
      const gap = 7;
      const width = Math.min(preferredWidth, Math.max(0, viewportWidth - margin * 2));
      const left = Math.max(
        margin,
        Math.min(rect.right - width, viewportWidth - width - margin)
      );
      const below = Math.max(0, viewportHeight - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - gap - margin);
      const openAbove = below < 220 && above > below;
      const availableHeight = openAbove ? above : below;
      panel.style.position = "fixed";
      panel.style.left = `${Math.round(left)}px`;
      panel.style.right = "auto";
      panel.style.width = `${Math.round(width)}px`;
      panel.style.maxWidth = `${Math.round(Math.max(0, viewportWidth - margin * 2))}px`;
      panel.style.maxHeight = `${Math.round(availableHeight)}px`;
      if (openAbove) {
        panel.style.top = "auto";
        panel.style.bottom = `${Math.round(viewportHeight - rect.top + gap)}px`;
      } else {
        panel.style.top = `${Math.round(rect.bottom + gap)}px`;
        panel.style.bottom = "auto";
      }
    }
    function update() {
      registrations.forEach(({ owner, panel, preferredWidth }) => {
        if (owner.open && !panel.hidden) position(owner, panel, preferredWidth);
      });
    }
    function bindGlobalEvents() {
      var _a;
      if (eventsBound) return;
      eventsBound = true;
      (_a = root.addEventListener) == null ? void 0 : _a.call(root, "resize", update);
      documentRef.addEventListener("scroll", update, true);
      const closeOutside = (event) => {
        registrations.forEach(({ owner, panel }) => {
          var _a2, _b;
          if (!owner.open) return;
          const inOwner = (_a2 = owner.contains) == null ? void 0 : _a2.call(owner, event.target);
          const inPanel = (_b = panel.contains) == null ? void 0 : _b.call(panel, event.target);
          if (!inOwner && !inPanel) close(owner);
        });
      };
      documentRef.addEventListener("pointerdown", closeOutside, true);
      documentRef.addEventListener("focusin", closeOutside, true);
    }
    function focusFirstControl(panel) {
      var _a, _b;
      for (const selector of [
        "button:not([disabled])",
        "input:not([disabled])",
        "[tabindex='0']"
      ]) {
        const focusable = (_a = panel.querySelector) == null ? void 0 : _a.call(panel, selector);
        if (focusable == null ? void 0 : focusable.focus) {
          focusable.focus();
          return;
        }
      }
      (_b = panel == null ? void 0 : panel.focus) == null ? void 0 : _b.call(panel);
    }
    function bind(owner, panel, preferredWidth) {
      var _a, _b, _c, _d, _e, _f, _g;
      if (!owner || !panel || owner.__quizifyFloatingPanelBound) return;
      owner.__quizifyFloatingPanelBound = true;
      owner.__quizifyFloatingPanel = panel;
      panel.__quizifyFloatingOwner = owner;
      panel.hidden = true;
      panel.setAttribute("tabindex", "-1");
      const registration = { owner, panel, preferredWidth };
      registrations.add(registration);
      const anchor = (_a = owner.querySelector) == null ? void 0 : _a.call(owner, "summary");
      const panelId = `quizify-floating-panel-${registrations.size}`;
      panel.id = panelId;
      panel.setAttribute("role", "dialog");
      const explicitPanelLabel = String(((_b = panel.getAttribute) == null ? void 0 : _b.call(panel, "aria-label")) || "").trim();
      panel.setAttribute(
        "aria-label",
        explicitPanelLabel || ((_c = anchor == null ? void 0 : anchor.getAttribute) == null ? void 0 : _c.call(anchor, "aria-label")) || (anchor == null ? void 0 : anchor.textContent) || "Quizify \u5DE5\u5177\u9762\u677F"
      );
      (_d = anchor == null ? void 0 : anchor.setAttribute) == null ? void 0 : _d.call(anchor, "aria-controls", panelId);
      (_e = anchor == null ? void 0 : anchor.setAttribute) == null ? void 0 : _e.call(anchor, "aria-haspopup", "dialog");
      (_f = anchor == null ? void 0 : anchor.setAttribute) == null ? void 0 : _f.call(anchor, "aria-expanded", "false");
      (_g = anchor == null ? void 0 : anchor.addEventListener) == null ? void 0 : _g.call(anchor, "keydown", (event) => {
        if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
          owner.__quizifyOpenedByKeyboard = true;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            owner.open = true;
          }
        }
      });
      owner.addEventListener("toggle", () => {
        var _a2, _b2;
        (_a2 = anchor == null ? void 0 : anchor.setAttribute) == null ? void 0 : _a2.call(anchor, "aria-expanded", String(Boolean(owner.open)));
        if (owner.open) {
          registrations.forEach(({ owner: itemOwner }) => {
            if (itemOwner !== owner) close(itemOwner);
          });
          documentRef.body.appendChild(panel);
          panel.hidden = false;
          addClassName(panel, "quizify-panel-portal");
          position(owner, panel, preferredWidth);
          if (owner.__quizifyOpenedByKeyboard) {
            owner.__quizifyOpenedByKeyboard = false;
            (_b2 = root.setTimeout) == null ? void 0 : _b2.call(root, () => focusFirstControl(panel), 0);
          }
        } else {
          close(owner);
        }
      });
      bindGlobalEvents();
    }
    function closeAll() {
      registrations.forEach(({ owner }) => close(owner));
    }
    return Object.freeze({ bind, closeAll, closeTop, update });
  }

  // src/editor/text-commands.js
  function offsetPosition(start, value, offset) {
    if (!start || !Number.isInteger(start.line) || !Number.isInteger(start.ch)) return null;
    const before = String(value).slice(0, Math.max(0, offset)).split("\n");
    return before.length === 1 ? { line: start.line, ch: start.ch + before[0].length } : { line: start.line + before.length - 1, ch: before.at(-1).length };
  }
  function applyInsertedSelection(editor, start, value, selection) {
    if (!selection || !start) return;
    const from = offsetPosition(start, value, selection.start);
    const to = offsetPosition(start, value, selection.end);
    if (!from || !to) return;
    const doc = typeof (editor == null ? void 0 : editor.getDoc) === "function" ? editor.getDoc() : editor == null ? void 0 : editor.doc;
    if (typeof (editor == null ? void 0 : editor.setSelection) === "function") editor.setSelection(from, to);
    else if (typeof (doc == null ? void 0 : doc.setSelection) === "function") doc.setSelection(from, to);
  }
  function editorDocument(editor) {
    return typeof (editor == null ? void 0 : editor.getDoc) === "function" ? editor.getDoc() : editor == null ? void 0 : editor.doc;
  }
  function copyPosition(position) {
    if (!position || !Number.isInteger(position.line) || !Number.isInteger(position.ch)) {
      return null;
    }
    return { line: position.line, ch: position.ch };
  }
  function captureEditorSelection(editor) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    if (!editor) return null;
    if (editor.cm) return captureEditorSelection(editor.cm);
    const selection = (_b = (_a = editor.state) == null ? void 0 : _a.selection) == null ? void 0 : _b.main;
    if (selection) {
      const anchor2 = Number.isInteger(selection.anchor) ? selection.anchor : selection.from;
      const head2 = Number.isInteger(selection.head) ? selection.head : selection.to;
      if (Number.isInteger(anchor2) && Number.isInteger(head2)) {
        return { kind: "offset", anchor: anchor2, head: head2 };
      }
    }
    const doc = editorDocument(editor);
    const range = ((_d = (_c = doc == null ? void 0 : doc.listSelections) == null ? void 0 : _c.call(doc)) == null ? void 0 : _d[0]) || ((_f = (_e = editor.listSelections) == null ? void 0 : _e.call(editor)) == null ? void 0 : _f[0]);
    const anchor = copyPosition(range == null ? void 0 : range.anchor);
    const head = copyPosition(range == null ? void 0 : range.head);
    if (anchor && head) return { kind: "position", anchor, head };
    const from = copyPosition(
      ((_g = editor.getCursor) == null ? void 0 : _g.call(editor, "from")) || ((_h = doc == null ? void 0 : doc.getCursor) == null ? void 0 : _h.call(doc, "from"))
    );
    const to = copyPosition(((_i = editor.getCursor) == null ? void 0 : _i.call(editor, "to")) || ((_j = doc == null ? void 0 : doc.getCursor) == null ? void 0 : _j.call(doc, "to")));
    return from && to ? { kind: "position", anchor: from, head: to } : null;
  }
  function restoreEditorSelection(editor, snapshot) {
    if (!editor || !snapshot) return false;
    if (editor.cm) return restoreEditorSelection(editor.cm, snapshot);
    if (snapshot.kind === "offset" && typeof editor.dispatch === "function") {
      editor.dispatch({
        selection: { anchor: snapshot.anchor, head: snapshot.head },
        scrollIntoView: true
      });
      return true;
    }
    if (snapshot.kind !== "position") return false;
    const doc = editorDocument(editor);
    if (typeof editor.setSelection === "function") {
      editor.setSelection(snapshot.anchor, snapshot.head);
      return true;
    }
    if (typeof (doc == null ? void 0 : doc.setSelection) === "function") {
      doc.setSelection(snapshot.anchor, snapshot.head);
      return true;
    }
    return false;
  }
  function replaceEditorSelection(editor, value, selection = null) {
    var _a, _b, _c;
    if (!editor) return false;
    const doc = editorDocument(editor);
    const start = typeof editor.getCursor === "function" && editor.getCursor("from") || typeof (doc == null ? void 0 : doc.getCursor) === "function" && doc.getCursor("from") || null;
    if (typeof editor.replaceSelection === "function") {
      editor.replaceSelection(value);
      applyInsertedSelection(editor, start, value, selection);
      return true;
    }
    if (typeof (doc == null ? void 0 : doc.replaceSelection) === "function") {
      doc.replaceSelection(value);
      applyInsertedSelection(editor, start, value, selection);
      return true;
    }
    if (typeof ((_a = editor.cm) == null ? void 0 : _a.replaceSelection) === "function") {
      return replaceEditorSelection(editor.cm, value, selection);
    }
    const currentSelection = (_c = (_b = editor.state) == null ? void 0 : _b.selection) == null ? void 0 : _c.main;
    if (currentSelection && typeof editor.dispatch === "function") {
      const insertedSelection = selection || { start: value.length, end: value.length };
      editor.dispatch({
        changes: {
          from: currentSelection.from,
          to: currentSelection.to,
          insert: value
        },
        selection: {
          anchor: currentSelection.from + insertedSelection.start,
          head: currentSelection.from + insertedSelection.end
        },
        scrollIntoView: true
      });
      return true;
    }
    return false;
  }
  function readEditorSelection(editor) {
    var _a, _b, _c, _d, _e;
    if (typeof (editor == null ? void 0 : editor.getSelection) === "function") return editor.getSelection();
    const doc = editorDocument(editor);
    if (typeof (doc == null ? void 0 : doc.getSelection) === "function") return doc.getSelection();
    if (typeof ((_a = editor == null ? void 0 : editor.cm) == null ? void 0 : _a.getSelection) === "function") return editor.cm.getSelection();
    const selection = (_c = (_b = editor == null ? void 0 : editor.state) == null ? void 0 : _b.selection) == null ? void 0 : _c.main;
    if (selection && typeof ((_e = (_d = editor.state) == null ? void 0 : _d.doc) == null ? void 0 : _e.sliceString) === "function") {
      return editor.state.doc.sliceString(selection.from, selection.to);
    }
    return "";
  }
  function placeholderSelection(value, preferred = null) {
    var _a;
    const source = String(value || "");
    const content = preferred || ((_a = /答案|题干|选项 A|内容一|标题|文件名\.mp3|需要背诵的内容/.exec(source)) == null ? void 0 : _a[0]);
    if (!content) return null;
    const start = source.indexOf(content);
    return start >= 0 ? { start, end: start + content.length } : null;
  }
  function markdownSelection(action, selection, value) {
    const selected = String(selection || "");
    if ((action.id === "link" || action.id === "image") && selected) {
      const urlStart = value.lastIndexOf("url");
      return urlStart >= 0 ? { start: urlStart, end: urlStart + 3 } : null;
    }
    if (selected) {
      const selectedStart = value.indexOf(selected);
      return selectedStart >= 0 ? { start: selectedStart, end: selectedStart + selected.length } : { start: 0, end: value.trimEnd().length };
    }
    return placeholderSelection(value, selected || action.placeholder || "");
  }

  // src/shared/anki-field.js
  function decodeAnkiFieldHtml(html, documentRef = globalThis.document) {
    var _a;
    const text = String(html != null ? html : "").replace(/&nbsp;/g, " ").replace(/<br\s*\/?>/gi, "\n");
    const decoder = ((_a = documentRef == null ? void 0 : documentRef.createElement) == null ? void 0 : _a.call(documentRef, "textarea")) || null;
    const fallback = () => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
    if (!decoder) return fallback();
    decoder.innerHTML = text;
    return typeof decoder.value === "string" ? decoder.value : fallback();
  }

  // src/editor/legacy-editor.js
  (() => {
    const adapter = loadAnkiEditorAdapter(globalThis);
    if (!adapter) {
      globalThis.quizifyEditorActivate = async () => {
        let notice = document.querySelector(".quizify-editor-unavailable");
        if (!notice) {
          notice = document.createElement("div");
          notice.className = "quizify-editor-unavailable";
          notice.setAttribute("role", "alert");
          notice.textContent = "Quizify \u7F16\u8F91\u5DE5\u5177\u65E0\u6CD5\u8FDE\u63A5\u5F53\u524D Anki \u7F16\u8F91\u5668 API\u3002\u5B57\u6BB5\u4ECD\u53EF\u7F16\u8F91\uFF0C\u8BF7\u66F4\u65B0 Quizify \u6216\u6539\u7528\u53D7\u652F\u6301\u7684 Anki \u7248\u672C\u3002";
          (document.querySelector(".fields") || document.body).prepend(notice);
        }
        notice.hidden = false;
        return false;
      };
      globalThis.quizifyEditorDeactivate = async () => {
        const notice = document.querySelector(".quizify-editor-unavailable");
        if (notice) notice.hidden = true;
        return false;
      };
      return;
    }
    const {
      loaded,
      noteEditors: instances,
      plainTextLifecycle: lifecycle,
      plainTextInputs: plainTexts
    } = adapter;
    const active = () => document.body.classList.contains("quizify-editor-active");
    const syntax = globalThis.QuizifySyntax || {};
    const snippets = syntax.snippets || [];
    const markdownActions = syntax.markdownActions || [];
    const previewLimit = 80;
    const markdownButtonSymbols = Object.freeze({
      link: "\u26D3",
      "github-alert": "!",
      blockquote: "\u275E",
      "unordered-list": "\u2022\u2261",
      "ordered-list": "1\u2261",
      "code-block": "{}",
      image: "\u25A7",
      table: "\u25A6"
    });
    const snippetButtonSymbols = Object.freeze(["\u586B", "\u9009", "\u63ED", "\u6CE8", "\u6298", "\u9875", "\u97F3", "\u80CC"]);
    let validationTimer = null;
    let toolbarResizeObserver = null;
    let lastEditor = null;
    let lastFieldIndex = 0;
    let commandContext = null;
    let fieldNameCache = [];
    let shortcutsBound = false;
    let sessionVersion = 0;
    const managedFieldNames = /* @__PURE__ */ new Set(["Front", "Back"]);
    const boundEditors = /* @__PURE__ */ new WeakMap();
    const boundElements = /* @__PURE__ */ new WeakSet();
    const floatingPanelManager = createFloatingPanelManager(globalThis, document);
    function installPlainTextPolicy() {
      var _a;
      if (!quizifyNotetypeId) return false;
      if (((_a = globalThis.__quizifyPlainTextPolicyState) == null ? void 0 : _a.notetypeId) === quizifyNotetypeId) {
        return false;
      }
      const setMetadata = globalThis.setNotetypeMeta;
      const setPlainTexts = globalThis.setPlainTexts;
      if (typeof setMetadata !== "function" || typeof setPlainTexts !== "function" || setPlainTexts.__quizifyPlainTextPolicy) {
        return false;
      }
      let currentMetadata = null;
      let cacheGeneration = 0;
      const metadataPolicy = (metadata) => {
        currentMetadata = metadata;
        return setMetadata(metadata);
      };
      const plainTextPolicy = (values) => {
        var _a2, _b;
        if (String((_a2 = currentMetadata == null ? void 0 : currentMetadata.id) != null ? _a2 : "") !== quizifyNotetypeId) {
          return setPlainTexts(values);
        }
        const requested = Array.from(
          values || [],
          (value, index) => quizifyPlainTextIndices.has(index) ? true : value
        );
        const actual = currentMetadata;
        const cacheBreaker = {
          ...actual,
          modTime: `quizify:${String((_b = actual.modTime) != null ? _b : "unknown")}:${++cacheGeneration}`
        };
        setMetadata(cacheBreaker);
        try {
          return setPlainTexts(requested);
        } finally {
          setMetadata(actual);
        }
      };
      plainTextPolicy.__quizifyPlainTextPolicy = true;
      globalThis.__quizifyPlainTextPolicyState = {
        notetypeId: quizifyNotetypeId,
        plainTextIndices: quizifyPlainTextIndices
      };
      globalThis.setNotetypeMeta = metadataPolicy;
      globalThis.setPlainTexts = plainTextPolicy;
      return true;
    }
    installPlainTextPolicy();
    loaded.then(installPlainTextPolicy);
    async function noteFields() {
      const noteEditor = instances.find((instance) => instance == null ? void 0 : instance.fields) || instances[0];
      const noteFields2 = await (noteEditor == null ? void 0 : noteEditor.fields) || [];
      fieldNameCache = noteFields2.map((field, index) => (field == null ? void 0 : field.name) || `\u5B57\u6BB5 ${index + 1}`);
      return noteFields2;
    }
    function nextPaint() {
      if (typeof globalThis.requestAnimationFrame !== "function") {
        return Promise.resolve();
      }
      return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    }
    function setOption(name, value) {
      plainTexts.forEach((input) => setEditorOption(editorForInput(input), name, value));
    }
    function editorForInput(input) {
      return normalizeEditor((input == null ? void 0 : input.codeMirror) || (input == null ? void 0 : input.cm) || (input == null ? void 0 : input.editor) || input);
    }
    function looksLikeEditor(value) {
      var _a, _b, _c, _d;
      return Boolean(
        value && (typeof value.replaceSelection === "function" || typeof value.getValue === "function" || typeof value.getDoc === "function" || typeof ((_a = value.cm) == null ? void 0 : _a.replaceSelection) === "function" || typeof ((_b = value.cm) == null ? void 0 : _b.getValue) === "function" || typeof ((_d = (_c = value.state) == null ? void 0 : _c.doc) == null ? void 0 : _d.toString) === "function")
      );
    }
    function codeMirrorFromNode(node) {
      var _a, _b;
      return normalizeEditor((node == null ? void 0 : node.CodeMirror) || ((_b = (_a = node == null ? void 0 : node.closest) == null ? void 0 : _a.call(node, ".CodeMirror")) == null ? void 0 : _b.CodeMirror));
    }
    function normalizeEditor(value) {
      if (!value) return null;
      if (looksLikeEditor(value)) return value;
      const nested = [
        value.cm,
        value.editor,
        value.codeMirror,
        value.view,
        value.instance
      ];
      for (const item of nested) {
        if (looksLikeEditor(item)) return item;
      }
      const element = value.element || value.node || value.dom || value.wrapper || value.root;
      if (element == null ? void 0 : element.querySelector) {
        return codeMirrorFromNode(element.querySelector(".CodeMirror")) || codeMirrorFromNode(element);
      }
      return null;
    }
    function fieldContainers() {
      var _a;
      return Array.from(((_a = document.querySelectorAll) == null ? void 0 : _a.call(document, ".field-container[data-index]")) || []);
    }
    function fieldContainer(index) {
      return fieldContainers().find((element) => Number(element.dataset.index) === index) || fieldContainers()[index] || null;
    }
    function editorFromDom(index) {
      var _a;
      return codeMirrorFromNode((_a = fieldContainer(index)) == null ? void 0 : _a.querySelector(".CodeMirror"));
    }
    function editorForField(index) {
      return editorForInput(plainTexts[index]) || editorFromDom(index);
    }
    function domFieldName(index) {
      var _a, _b, _c;
      const container = fieldContainer(index);
      for (const selector of [".label-name", ".field-name", ".field-label", "label"]) {
        const text = (_c = (_b = (_a = container == null ? void 0 : container.querySelector) == null ? void 0 : _a.call(container, selector)) == null ? void 0 : _b.textContent) == null ? void 0 : _c.trim();
        if (text) return text;
      }
      return "";
    }
    function fieldName(index) {
      const cached = fieldNameCache[index];
      if (cached && !/^字段\s*\d+$/i.test(cached)) return cached;
      return domFieldName(index) || cached || `\u5B57\u6BB5 ${index + 1}`;
    }
    function fieldDisplayName(entry) {
      if (!entry) return "\u672A\u9009\u62E9\u5B57\u6BB5";
      const name = fieldName(entry.index);
      return /^字段\s*\d+$/i.test(name) || name.endsWith("\u5B57\u6BB5") ? name : `${name} \u5B57\u6BB5`;
    }
    function isManagedEntry(entry) {
      return Boolean(entry && managedFieldNames.has(fieldName(entry.index)));
    }
    function allFieldEditors() {
      const count = Math.max(plainTexts.length, fieldContainers().length, fieldNameCache.length);
      return Array.from({ length: count }, (_, index) => ({
        field: index + 1,
        index,
        name: fieldName(index),
        editor: editorForField(index),
        container: fieldContainer(index)
      }));
    }
    function rememberEditor(editor, index = lastFieldIndex) {
      if (Number.isInteger(index)) lastFieldIndex = index;
      if (editor) lastEditor = editor;
    }
    function rememberCommandContext(entry = null) {
      const target = entry || currentFieldEntry();
      if (!isManagedEntry(target) || !(target == null ? void 0 : target.editor)) return null;
      rememberEditor(target.editor, target.index);
      commandContext = {
        editor: target.editor,
        index: target.index,
        selection: captureEditorSelection(target.editor)
      };
      return commandContext;
    }
    function commandEntry() {
      const context = commandContext;
      const entries = allFieldEditors();
      const entry = context ? entries.find(
        (item) => item.index === context.index && item.editor === context.editor
      ) : currentFieldEntry();
      if (!isManagedEntry(entry) || !(entry == null ? void 0 : entry.editor)) return null;
      if ((context == null ? void 0 : context.editor) === entry.editor) {
        restoreEditorSelection(entry.editor, context.selection);
      }
      rememberEditor(entry.editor, entry.index);
      return entry;
    }
    function bindCommandActivation(button, callback) {
      const preserve = () => rememberCommandContext();
      button.addEventListener("pointerdown", preserve);
      button.addEventListener("mousedown", (event) => {
        preserve();
        event.preventDefault();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const entry = commandEntry();
        if (!entry) return;
        callback(entry);
        rememberCommandContext(entry);
      });
    }
    function bindPanelSelectionPreservation(summary) {
      const preserve = () => rememberCommandContext();
      summary.addEventListener("pointerdown", preserve);
      summary.addEventListener("mousedown", (event) => {
        preserve();
        event.preventDefault();
      });
    }
    function editorHasFocus(editor) {
      var _a, _b, _c, _d, _e;
      if (!editor) return false;
      if (typeof editor.hasFocus === "function") return editor.hasFocus();
      if (typeof editor.hasFocus === "boolean") return editor.hasFocus;
      if (typeof ((_a = editor.cm) == null ? void 0 : _a.hasFocus) === "function") return editor.cm.hasFocus();
      if (typeof editor.getWrapperElement === "function") {
        return ((_c = (_b = editor.getWrapperElement()) == null ? void 0 : _b.contains) == null ? void 0 : _c.call(_b, document.activeElement)) || false;
      }
      return ((_e = (_d = editor.dom) == null ? void 0 : _d.contains) == null ? void 0 : _e.call(_d, document.activeElement)) || false;
    }
    function currentFieldEntry() {
      const entries = allFieldEditors();
      const focused = entries.find((entry) => editorHasFocus(entry.editor));
      if (focused == null ? void 0 : focused.editor) {
        rememberEditor(focused.editor, focused.index);
        return focused;
      }
      const remembered = entries.find(
        (entry) => entry.index === lastFieldIndex && (entry.editor || entry.container)
      );
      if (remembered) {
        rememberEditor(remembered.editor, remembered.index);
        return remembered;
      }
      const fromLastEditor = entries.find((entry) => entry.editor && entry.editor === lastEditor);
      if (fromLastEditor) {
        rememberEditor(fromLastEditor.editor, fromLastEditor.index);
        return fromLastEditor;
      }
      const first = entries.find((entry) => entry.editor || entry.container);
      if (first == null ? void 0 : first.editor) rememberEditor(first.editor, first.index);
      return first || null;
    }
    function focusedEditor() {
      const entry = currentFieldEntry();
      if (entry == null ? void 0 : entry.editor) rememberEditor(entry.editor, entry.index);
      return (entry == null ? void 0 : entry.editor) || null;
    }
    function fieldEntryForTarget(target) {
      var _a;
      const container = (_a = target == null ? void 0 : target.closest) == null ? void 0 : _a.call(target, ".field-container[data-index]");
      if (!container) return null;
      const index = Number(container.dataset.index);
      if (!Number.isInteger(index)) return null;
      const entry = allFieldEditors().find((item) => item.index === index) || null;
      if (entry == null ? void 0 : entry.editor) rememberEditor(entry.editor, entry.index);
      return entry;
    }
    function focusEditor(editor) {
      var _a;
      if (typeof editor.focus === "function") {
        editor.focus();
      } else if (typeof ((_a = editor.cm) == null ? void 0 : _a.focus) === "function") {
        editor.cm.focus();
      }
    }
    function editorValue(editor) {
      var _a, _b, _c, _d;
      if (typeof (editor == null ? void 0 : editor.getValue) === "function") return editor.getValue();
      if (typeof (editor == null ? void 0 : editor.getDoc) === "function" && typeof ((_a = editor.getDoc()) == null ? void 0 : _a.getValue) === "function") {
        return editor.getDoc().getValue();
      }
      if (typeof ((_b = editor == null ? void 0 : editor.cm) == null ? void 0 : _b.getValue) === "function") return editor.cm.getValue();
      if (typeof ((_d = (_c = editor == null ? void 0 : editor.state) == null ? void 0 : _c.doc) == null ? void 0 : _d.toString) === "function") {
        return editor.state.doc.toString();
      }
      return "";
    }
    function domEditorValue(container) {
      var _a;
      const lines = Array.from(((_a = container == null ? void 0 : container.querySelectorAll) == null ? void 0 : _a.call(container, ".CodeMirror-code pre")) || []);
      return lines.map((line) => line.textContent.replace(/\u200b/g, "")).join("\n").trimEnd();
    }
    function setEditorOption(editor, name, value) {
      var _a;
      if (typeof (editor == null ? void 0 : editor.setOption) === "function") return editor.setOption(name, value);
      if (typeof ((_a = editor == null ? void 0 : editor.cm) == null ? void 0 : _a.setOption) === "function") return editor.cm.setOption(name, value);
      return void 0;
    }
    function insertSnippet(snippet, targetEntry = null) {
      var _a;
      if (!active()) return false;
      const entry = targetEntry || currentFieldEntry();
      if (!isManagedEntry(entry)) return false;
      const editor = (entry == null ? void 0 : entry.editor) || focusedEditor();
      if (!editor) return false;
      if (!replaceEditorSelection(editor, snippet, placeholderSelection(snippet))) return false;
      rememberEditor(editor, (_a = entry == null ? void 0 : entry.index) != null ? _a : lastFieldIndex);
      focusEditor(editor);
      rememberCommandContext(entry);
      scheduleValidation();
      return true;
    }
    function insertMarkdownAction(action, targetEntry = null) {
      var _a;
      if (!active()) return false;
      const entry = targetEntry || currentFieldEntry();
      if (!isManagedEntry(entry)) return false;
      const editor = (entry == null ? void 0 : entry.editor) || focusedEditor();
      if (!editor) return false;
      const selection = readEditorSelection(editor);
      const value = typeof syntax.formatMarkdownAction === "function" ? syntax.formatMarkdownAction(action, selection) : `${action.prefix || ""}${selection || action.placeholder || ""}${action.suffix || ""}`;
      if (!replaceEditorSelection(editor, value, markdownSelection(action, selection, value))) return false;
      rememberEditor(editor, (_a = entry == null ? void 0 : entry.index) != null ? _a : lastFieldIndex);
      focusEditor(editor);
      rememberCommandContext(entry);
      scheduleValidation();
      return true;
    }
    function toolbarStatus() {
      return document.querySelector(".quizify-diagnostics-status");
    }
    function diagnosticsList() {
      return document.querySelector(".quizify-diagnostics-list");
    }
    function previewList() {
      return document.querySelector(".quizify-preview-list");
    }
    function previewFieldLabel() {
      return document.querySelector(".quizify-preview-field");
    }
    function previewCountLabel() {
      return document.querySelector(".quizify-preview-count");
    }
    function entryValue(entry) {
      const value = (entry == null ? void 0 : entry.editor) ? editorValue(entry.editor) : domEditorValue(entry == null ? void 0 : entry.container);
      return decodeAnkiFieldHtml(value, document);
    }
    function updateCommandAvailability(entry) {
      const enabled = Boolean(active() && isManagedEntry(entry) && (entry == null ? void 0 : entry.editor));
      for (const selector of [".quizify-markdown-button", ".quizify-snippet-button"]) {
        document.querySelectorAll(selector).forEach((button) => {
          button.disabled = !enabled;
          button.setAttribute("aria-disabled", String(!enabled));
        });
      }
      const hint = document.querySelector(".quizify-command-hint");
      if (hint) {
        hint.hidden = enabled;
        hint.textContent = active() ? "\u8BF7\u5148\u805A\u7126 Front \u6216 Back \u5B57\u6BB5" : "Quizify \u7F16\u8F91\u5DE5\u5177\u5DF2\u505C\u7528";
      }
    }
    function focusDiagnostic(entry, item) {
      var _a, _b;
      const editor = entry == null ? void 0 : entry.editor;
      if (!editor) return;
      const line = Math.max(0, Number((item == null ? void 0 : item.line) || 1) - 1);
      const ch = Math.max(0, Number((item == null ? void 0 : item.column) || 1) - 1);
      const doc = typeof editor.getDoc === "function" ? editor.getDoc() : editor.doc;
      if (typeof editor.setCursor === "function") editor.setCursor({ line, ch });
      else if (typeof (doc == null ? void 0 : doc.setCursor) === "function") doc.setCursor({ line, ch });
      else if (typeof ((_b = (_a = editor.state) == null ? void 0 : _a.doc) == null ? void 0 : _b.line) === "function" && typeof editor.dispatch === "function") {
        const targetLine = editor.state.doc.line(
          Math.min(line + 1, editor.state.doc.lines || line + 1)
        );
        const anchor = Math.min(targetLine.to, targetLine.from + ch);
        editor.dispatch({ selection: { anchor }, scrollIntoView: true });
      }
      rememberEditor(editor, entry.index);
      focusEditor(editor);
      scheduleValidation();
    }
    function updateToolbarContext(entry) {
      const displayName = fieldDisplayName(entry);
      const toolbar = document.querySelector(".quizify-toolbar");
      if (toolbar) {
        toolbar.setAttribute("aria-label", `Quizify \u7F16\u8F91\u5DE5\u5177\uFF0C\u5F53\u524D\u5B57\u6BB5\uFF1A${displayName}`);
      }
      const previewSummary = document.querySelector(".quizify-command-summary");
      if (previewSummary) {
        previewSummary.title = `\u9884\u89C8 ${displayName} \u7684\u4EA4\u4E92\u6E32\u67D3`;
        previewSummary.setAttribute(
          "aria-label",
          `\u6253\u5F00 ${displayName} \u7684\u4EA4\u4E92\u6E32\u67D3\u9884\u89C8`
        );
      }
    }
    function updatePreviewFieldLabel(entry) {
      const previewLabel = previewFieldLabel();
      const displayName = fieldDisplayName(entry);
      if (previewLabel) previewLabel.textContent = displayName;
    }
    function validateEditors() {
      if (!active() || typeof syntax.analyzeQuizifySyntax !== "function") return;
      const status = toolbarStatus();
      const list = diagnosticsList();
      if (!status || !list) return;
      const entry = currentFieldEntry();
      updateToolbarContext(entry);
      updateCommandAvailability(entry);
      const managedEntries = allFieldEditors().filter(
        (item) => isManagedEntry(item) && (item.editor || item.container)
      );
      if (!managedEntries.length) {
        status.textContent = "\u8BF7\u9009\u62E9\u4E00\u4E2A\u5B57\u6BB5";
        status.title = "\u8BF7\u9009\u62E9\u4E00\u4E2A\u5B57\u6BB5";
        status.dataset.state = "warning";
        list.replaceChildren();
        renderPreview([], null);
        return;
      }
      const diagnostics = managedEntries.flatMap(
        (managedEntry) => syntax.analyzeQuizifySyntax(entryValue(managedEntry)).map((item) => ({
          ...item,
          field: managedEntry.field,
          fieldName: fieldName(managedEntry.index),
          entry: managedEntry
        }))
      );
      const previewEntry = isManagedEntry(entry) ? entry : managedEntries[0];
      const value = entryValue(previewEntry);
      const preview = typeof syntax.collectQuizifyPreview === "function" ? syntax.collectQuizifyPreview(value).map((item) => ({
        ...item,
        field: previewEntry.field,
        fieldName: fieldName(previewEntry.index)
      })) : [];
      const summary = syntax.summarizeDiagnostics(diagnostics);
      status.textContent = summary;
      status.title = summary;
      status.dataset.state = diagnostics.some((item) => item.severity === "error") ? "error" : diagnostics.length ? "warning" : "ok";
      list.replaceChildren();
      for (const item of diagnostics.slice(0, 8)) {
        const row = document.createElement("li");
        row.dataset.severity = item.severity;
        row.textContent = `${item.fieldName} \u5B57\u6BB5 \xB7 \u7B2C ${item.line} \u884C\uFF1A${item.message}`;
        row.tabIndex = 0;
        row.setAttribute("role", "button");
        row.setAttribute("aria-label", `\u8DF3\u8F6C\u5230 ${item.fieldName} \u5B57\u6BB5\u7B2C ${item.line} \u884C\uFF1A${item.message}`);
        row.addEventListener("click", () => focusDiagnostic(item.entry, item));
        row.addEventListener("keydown", (event) => {
          var _a;
          if (event.key !== "Enter" && event.key !== " ") return;
          (_a = event.preventDefault) == null ? void 0 : _a.call(event);
          focusDiagnostic(item.entry, item);
        });
        list.appendChild(row);
      }
      if (diagnostics.length > 8) {
        const row = document.createElement("li");
        row.textContent = `\u8FD8\u6709 ${diagnostics.length - 8} \u6761\u95EE\u9898\u672A\u663E\u793A\u3002`;
        list.appendChild(row);
      }
      renderPreview(preview, previewEntry);
    }
    function describePreview(item) {
      const meta = item.meta || {};
      if (item.kind === "fitb") return `\u7B54\u6848\uFF1A${meta.answer}`;
      if (item.kind === "single" || item.kind === "multiple") return `\u9009\u9879\uFF1A${meta.options}\uFF1B\u7B54\u6848\uFF1A${meta.answers}`;
      if (item.kind === "reveal") return `\u9898\u5E72\uFF1A${meta.question}\uFF1B\u7B54\u6848\uFF1A${meta.answer}`;
      if (item.kind === "annotation") return `\u6B63\u6587\uFF1A${meta.text}\uFF1B\u6279\u6CE8\uFF1A${meta.note}`;
      if (item.kind === "audio") return `${meta.title} -> ${meta.url}`;
      if (item.kind === "recite") return `\u906E\u6321\uFF1A${meta.mask}%\uFF1B\u6A21\u5F0F\uFF1A${meta.mode}`;
      if (item.kind === "collapse" || item.kind === "tab") return meta.title;
      return "";
    }
    function renderPreview(preview, entry) {
      const list = previewList();
      if (!list) return;
      const count = previewCountLabel();
      if (count) count.textContent = preview.length ? `${preview.length} \u4E2A\u7ED3\u6784` : "\u65E0\u7ED3\u6784";
      updatePreviewFieldLabel(entry);
      list.replaceChildren();
      if (!preview.length) {
        const row = document.createElement("li");
        row.className = "quizify-preview-empty";
        row.textContent = entry ? `${fieldDisplayName(entry)}\u8FD8\u6CA1\u6709\u68C0\u6D4B\u5230 Quizify \u9898\u578B\u3002` : "\u8BF7\u9009\u62E9\u4E00\u4E2A\u5B57\u6BB5\u67E5\u770B Quizify \u7ED3\u6784\u3002";
        list.appendChild(row);
        return;
      }
      for (const item of preview.slice(0, previewLimit)) {
        const row = document.createElement("li");
        row.dataset.kind = item.kind;
        const kind = document.createElement("span");
        kind.className = "quizify-preview-kind";
        kind.textContent = item.title;
        row.appendChild(kind);
        const title = document.createElement("strong");
        title.textContent = `\u7B2C ${item.line} \u884C`;
        row.appendChild(title);
        const detail = document.createElement("span");
        detail.className = "quizify-preview-detail";
        detail.textContent = describePreview(item);
        row.appendChild(detail);
        list.appendChild(row);
      }
      if (preview.length > previewLimit) {
        const row = document.createElement("li");
        row.className = "quizify-preview-empty";
        row.textContent = `\u8FD8\u6709 ${preview.length - previewLimit} \u4E2A\u7ED3\u6784\u672A\u663E\u793A\u3002`;
        list.appendChild(row);
      }
    }
    function scheduleValidation() {
      clearTimeout(validationTimer);
      validationTimer = setTimeout(validateEditors, 120);
    }
    function bindEditor(input, index = lastFieldIndex) {
      const editor = editorForInput(input);
      bindEditorObject(editor, index);
    }
    function fieldIndexForInput(input) {
      var _a, _b;
      const direct = plainTexts.indexOf(input);
      if (direct >= 0) return direct;
      const editor = editorForInput(input);
      const matched = allFieldEditors().find((entry) => entry.editor === editor);
      if (matched) return matched.index;
      const element = (input == null ? void 0 : input.element) || (input == null ? void 0 : input.node) || (input == null ? void 0 : input.dom) || (input == null ? void 0 : input.wrapper) || (input == null ? void 0 : input.root);
      const container = (_a = element == null ? void 0 : element.closest) == null ? void 0 : _a.call(element, ".field-container[data-index]");
      const index = Number((_b = container == null ? void 0 : container.dataset) == null ? void 0 : _b.index);
      return Number.isInteger(index) ? index : lastFieldIndex;
    }
    function bindEditorObject(editor, index = lastFieldIndex) {
      var _a;
      if (!editor) return;
      const existing = boundEditors.get(editor);
      if (existing) {
        if (Number.isInteger(index)) existing.index = index;
        return;
      }
      const binding = { index: Number.isInteger(index) ? index : lastFieldIndex };
      boundEditors.set(editor, binding);
      const remember = () => {
        rememberEditor(editor, binding.index);
        const entry = allFieldEditors().find((item) => item.index === binding.index);
        if (entry) rememberCommandContext(entry);
        scheduleValidation();
      };
      if (typeof editor.on === "function") {
        editor.on("change", scheduleValidation);
        editor.on("focus", remember);
        editor.on("cursorActivity", remember);
      } else if (typeof ((_a = editor.cm) == null ? void 0 : _a.on) === "function") {
        editor.cm.on("change", scheduleValidation);
        editor.cm.on("focus", remember);
        editor.cm.on("cursorActivity", remember);
      }
    }
    function bindFieldElement(container, index) {
      if (!container || boundElements.has(container)) return;
      boundElements.add(container);
      const remember = (event) => {
        const editor = editorFromDom(index) || editorForField(index);
        rememberEditor(editor, index);
        const entry = allFieldEditors().find((item) => item.index === index);
        if (entry) rememberCommandContext(entry);
        scheduleValidation();
      };
      for (const name of ["focusin", "mousedown", "keyup", "input", "paste", "cut"]) {
        container.addEventListener(name, remember, true);
      }
    }
    function bindVisibleEditors() {
      allFieldEditors().forEach((entry) => {
        bindEditorObject(entry.editor, entry.index);
        bindFieldElement(entry.container, entry.index);
        setEditorOption(entry.editor, "lineWrapping", true);
      });
    }
    function shortcutFor(index) {
      return `Ctrl+Alt+${index + 1}`;
    }
    function shortcutAriaLabel(index) {
      return `Control+Alt+${index + 1}`;
    }
    function shortcutIndexForEvent(event) {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return -1;
      const key = String(event.key || "");
      const codeMatch = /^(?:Digit|Numpad)([1-9])$/.exec(String(event.code || ""));
      const digit = /^[1-9]$/.test(key) ? key : codeMatch == null ? void 0 : codeMatch[1];
      if (!digit) return -1;
      const index = Number(digit) - 1;
      return index >= 0 && index < snippets.length ? index : -1;
    }
    function handleShortcut(event) {
      var _a, _b, _c, _d, _e, _f;
      if (event.key === "Escape" && floatingPanelManager.closeTop(true)) {
        (_a = event.preventDefault) == null ? void 0 : _a.call(event);
        (_b = event.stopPropagation) == null ? void 0 : _b.call(event);
        return;
      }
      if (!active() || event.defaultPrevented || event.isComposing) return;
      const targetEntry = fieldEntryForTarget(event.target);
      if (!isManagedEntry(targetEntry) || !(targetEntry == null ? void 0 : targetEntry.editor)) return;
      const markdownAction = markdownActions.find((action) => {
        if (!action.key && !action.code) return false;
        const primary = event.ctrlKey || event.metaKey;
        if (!primary || event.altKey) return false;
        if (Boolean(action.shift) !== Boolean(event.shiftKey)) return false;
        if (action.code) return event.code === action.code;
        return String(event.key || "").toLowerCase() === action.key;
      });
      if (markdownAction) {
        if (!insertMarkdownAction(markdownAction, targetEntry)) return;
        (_c = event.preventDefault) == null ? void 0 : _c.call(event);
        (_d = event.stopPropagation) == null ? void 0 : _d.call(event);
        return;
      }
      const index = shortcutIndexForEvent(event);
      if (index < 0) return;
      if (!insertSnippet(snippets[index][1], targetEntry)) return;
      (_e = event.preventDefault) == null ? void 0 : _e.call(event);
      (_f = event.stopPropagation) == null ? void 0 : _f.call(event);
    }
    function bindShortcuts() {
      if (shortcutsBound) return;
      if (typeof document.addEventListener !== "function") return;
      document.addEventListener("keydown", handleShortcut, true);
      shortcutsBound = true;
    }
    function hasClassName2(element, name) {
      return String((element == null ? void 0 : element.className) || "").split(/\s+/).includes(name);
    }
    function addClassName2(element, name) {
      if (!element || hasClassName2(element, name)) return;
      element.className = `${element.className || ""} ${name}`.trim();
    }
    function removeClassName2(element, name) {
      if (!element) return;
      element.className = String(element.className || "").split(/\s+/).filter((item) => item && item !== name).join(" ");
    }
    function nativeEditorToolbar() {
      return document.querySelector(".note-editor > .editor-toolbar") || document.querySelector(".editor-toolbar");
    }
    function stopObservingToolbarResize() {
      var _a;
      (_a = toolbarResizeObserver == null ? void 0 : toolbarResizeObserver.disconnect) == null ? void 0 : _a.call(toolbarResizeObserver);
      toolbarResizeObserver = null;
    }
    function observeToolbarResize(toolbar) {
      stopObservingToolbarResize();
      const ResizeObserverCtor = globalThis.ResizeObserver;
      if (!toolbar || typeof ResizeObserverCtor !== "function") return;
      const observer = new ResizeObserverCtor(() => {
        if (toolbarResizeObserver !== observer || !active() || toolbar.isConnected === false) {
          return;
        }
        floatingPanelManager.update();
      });
      toolbarResizeObserver = observer;
      observer.observe(toolbar);
      const nativeToolbar = nativeEditorToolbar();
      if (nativeToolbar && nativeToolbar !== toolbar) observer.observe(nativeToolbar);
    }
    function insertAfter(reference, element) {
      var _a;
      if (!reference || !element) return false;
      if (typeof reference.after === "function") {
        reference.after(element);
        return true;
      }
      if ((_a = reference.parentNode) == null ? void 0 : _a.insertBefore) {
        reference.parentNode.insertBefore(element, reference.nextSibling || null);
        return true;
      }
      return false;
    }
    function dockToolbar(toolbar) {
      var _a;
      const nativeToolbar = nativeEditorToolbar();
      const siblings = Array.from(((_a = nativeToolbar == null ? void 0 : nativeToolbar.parentNode) == null ? void 0 : _a.children) || []);
      const alreadyDocked = siblings[siblings.indexOf(nativeToolbar) + 1] === toolbar;
      if ((nativeToolbar == null ? void 0 : nativeToolbar.parentNode) && (alreadyDocked || insertAfter(nativeToolbar, toolbar))) {
        addClassName2(toolbar, "quizify-toolbar-docked");
        toolbar.dataset.docked = "native";
        return;
      }
      removeClassName2(toolbar, "quizify-toolbar-docked");
      toolbar.dataset.docked = "fields";
      const host = document.querySelector(".fields") || document.body;
      host.prepend(toolbar);
    }
    function ensureToolbar() {
      const existing = document.querySelector(".quizify-toolbar");
      if (existing) {
        existing.hidden = false;
        dockToolbar(existing);
        observeToolbarResize(existing);
        bindShortcuts();
        return;
      }
      const toolbar = document.createElement("div");
      toolbar.className = "quizify-toolbar";
      toolbar.hidden = false;
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", "Quizify \u7F16\u8F91\u5DE5\u5177\uFF0C\u5F53\u524D\u5B57\u6BB5\uFF1A\u672A\u9009\u62E9\u5B57\u6BB5");
      toolbar.setAttribute("aria-orientation", "horizontal");
      const inspector = document.createElement("details");
      inspector.className = "quizify-inspector";
      const status = document.createElement("summary");
      status.className = "quizify-tool-button quizify-diagnostics-status";
      status.dataset.state = "ok";
      status.textContent = "\u8BED\u6CD5\u901A\u8FC7";
      status.title = "\u8BED\u6CD5\u901A\u8FC7";
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      bindPanelSelectionPreservation(status);
      inspector.appendChild(status);
      const commands = document.createElement("div");
      commands.className = "quizify-command-bar";
      commands.setAttribute("aria-label", "Markdown \u683C\u5F0F\u3001Quizify \u9898\u578B\u3001\u8BED\u6CD5\u68C0\u67E5\u548C\u6E32\u67D3\u9884\u89C8");
      const commandHint = document.createElement("span");
      commandHint.className = "quizify-command-hint";
      commandHint.setAttribute("role", "status");
      commandHint.setAttribute("aria-live", "polite");
      commandHint.textContent = "\u8BF7\u5148\u805A\u7126 Front \u6216 Back \u5B57\u6BB5";
      toolbar.appendChild(commandHint);
      function createMarkdownButton(action) {
        const button = document.createElement("button");
        const shortcut = String(action.shortcut || "").trim();
        button.type = "button";
        button.className = "quizify-tool-button quizify-markdown-button";
        button.title = shortcut ? `${action.label} (${shortcut})` : action.label;
        button.dataset.action = action.id;
        button.dataset.label = action.label;
        button.disabled = true;
        button.setAttribute(
          "aria-label",
          shortcut ? `Markdown\uFF1A${action.label}\uFF0C\u5FEB\u6377\u952E ${shortcut}` : `Markdown\uFF1A${action.label}`
        );
        if (shortcut) {
          button.setAttribute("aria-keyshortcuts", shortcut.replace("Ctrl", "Control"));
        }
        button.setAttribute("aria-disabled", "true");
        const symbol = document.createElement("span");
        symbol.className = "quizify-markdown-symbol";
        symbol.textContent = markdownButtonSymbols[action.id] || action.button;
        symbol.setAttribute("aria-hidden", "true");
        button.appendChild(symbol);
        bindCommandActivation(button, (entry) => insertMarkdownAction(action, entry));
        return button;
      }
      markdownActions.forEach((action) => commands.appendChild(createMarkdownButton(action)));
      snippets.forEach(([label, snippet], index) => {
        const shortcut = shortcutFor(index);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "quizify-tool-button quizify-snippet-button";
        button.title = `${label} (${shortcut})`;
        button.dataset.label = label;
        button.dataset.shortcut = shortcut;
        button.disabled = true;
        button.setAttribute("aria-label", `${label}\uFF0CQuizify \u9898\u578B\uFF0C\u5FEB\u6377\u952E ${shortcut}`);
        button.setAttribute("aria-keyshortcuts", shortcutAriaLabel(index));
        button.setAttribute("aria-disabled", "true");
        const symbol = document.createElement("span");
        symbol.className = "quizify-snippet-symbol";
        symbol.textContent = snippetButtonSymbols[index] || label.slice(0, 2);
        symbol.setAttribute("aria-hidden", "true");
        button.appendChild(symbol);
        const shortcutText = document.createElement("kbd");
        shortcutText.className = "quizify-shortcut";
        shortcutText.textContent = shortcut;
        button.appendChild(shortcutText);
        bindCommandActivation(button, (entry) => insertSnippet(snippet, entry));
        commands.appendChild(button);
      });
      const previewMenu = document.createElement("details");
      previewMenu.className = "quizify-command-menu quizify-preview-menu";
      const previewSummary = document.createElement("summary");
      previewSummary.className = "quizify-tool-button quizify-command-summary";
      previewSummary.textContent = "\u6E32\u67D3";
      previewSummary.title = "\u4EA4\u4E92\u6E32\u67D3\u9884\u89C8";
      previewSummary.setAttribute("aria-label", "\u6253\u5F00\u5F53\u524D\u5B57\u6BB5\u7684\u4EA4\u4E92\u6E32\u67D3\u9884\u89C8");
      bindPanelSelectionPreservation(previewSummary);
      previewMenu.appendChild(previewSummary);
      const livePreviewPanel = document.createElement("div");
      livePreviewPanel.className = "quizify-live-preview-panel";
      livePreviewPanel.setAttribute("aria-label", "\u5F53\u524D\u5B57\u6BB5\u6E32\u67D3\u9884\u89C8");
      previewMenu.appendChild(livePreviewPanel);
      previewMenu.addEventListener("toggle", () => {
        var _a;
        if (!previewMenu.open) return;
        (_a = globalThis.quizifyLoadEditorPreview) == null ? void 0 : _a.call(globalThis).catch((error) => {
          livePreviewPanel.textContent = (error == null ? void 0 : error.message) || "Quizify \u9884\u89C8\u52A0\u8F7D\u5931\u8D25";
        });
      });
      floatingPanelManager.bind(previewMenu, livePreviewPanel, 860);
      commands.appendChild(inspector);
      commands.appendChild(previewMenu);
      toolbar.appendChild(commands);
      const diagnostics = document.createElement("ul");
      diagnostics.className = "quizify-diagnostics-list";
      const preview = document.createElement("section");
      preview.className = "quizify-preview";
      const previewHeader = document.createElement("div");
      previewHeader.className = "quizify-preview-header";
      const previewTitle = document.createElement("strong");
      previewTitle.textContent = "\u7ED3\u6784\u9884\u89C8";
      previewHeader.appendChild(previewTitle);
      const previewMeta = document.createElement("span");
      previewMeta.className = "quizify-preview-meta";
      const previewField = document.createElement("span");
      previewField.className = "quizify-preview-field";
      previewField.textContent = "\u5B57\u6BB5 1";
      previewMeta.appendChild(previewField);
      const previewCount = document.createElement("span");
      previewCount.className = "quizify-preview-count";
      previewCount.textContent = "\u65E0\u7ED3\u6784";
      previewMeta.appendChild(previewCount);
      previewHeader.appendChild(previewMeta);
      preview.appendChild(previewHeader);
      const previewItems = document.createElement("ol");
      previewItems.className = "quizify-preview-list";
      preview.appendChild(previewItems);
      const inspectorPanel = document.createElement("div");
      inspectorPanel.className = "quizify-inspector-panel";
      inspectorPanel.setAttribute("aria-label", "Quizify \u8BED\u6CD5\u68C0\u67E5\u4E0E\u7ED3\u6784\u9884\u89C8");
      inspectorPanel.appendChild(diagnostics);
      inspectorPanel.appendChild(preview);
      inspector.appendChild(inspectorPanel);
      floatingPanelManager.bind(inspector, inspectorPanel, 760);
      dockToolbar(toolbar);
      observeToolbarResize(toolbar);
      bindShortcuts();
    }
    globalThis.quizifyEditorCurrentField = () => {
      if (!active()) return null;
      const entry = currentFieldEntry();
      return isManagedEntry(entry) ? {
        index: entry.index,
        name: fieldDisplayName(entry),
        value: entryValue(entry)
      } : null;
    };
    globalThis.quizifyEditorActivate = async () => {
      const version = ++sessionVersion;
      await loaded;
      if (version !== sessionVersion) return false;
      const noteFieldList = await noteFields();
      if (version !== sessionVersion) return false;
      lastEditor = null;
      lastFieldIndex = 0;
      commandContext = null;
      document.body.classList.add("quizify-editor-active");
      await nextPaint();
      if (version !== sessionVersion) return false;
      setOption("lineWrapping", true);
      ensureToolbar();
      plainTexts.forEach((input, index) => bindEditor(input, index));
      bindVisibleEditors();
      scheduleValidation();
      return true;
    };
    globalThis.quizifyEditorDeactivate = async () => {
      const version = ++sessionVersion;
      clearTimeout(validationTimer);
      validationTimer = null;
      stopObservingToolbarResize();
      floatingPanelManager.closeAll();
      document.body.classList.remove("quizify-editor-active");
      const toolbar = document.querySelector(".quizify-toolbar");
      if (toolbar) toolbar.hidden = true;
      updateCommandAvailability(null);
      lastEditor = null;
      lastFieldIndex = 0;
      commandContext = null;
      return true;
    };
    lifecycle.onMount((input) => {
      if (!active()) return;
      const index = fieldIndexForInput(input);
      setEditorOption(editorForInput(input), "lineWrapping", true);
      bindEditor(input, index);
      bindVisibleEditors();
      scheduleValidation();
    });
  })();
})();
