import "./dependencies.js";
import { MAX_FIELD_BYTES, sanitizeRenderedHtml } from "./security.js";
import { createPlatform } from "./platform.js";
import { createLifecycle } from "./lifecycle.js";
import { createMarkdownTools } from "./markdown/extensions.js";
import { createReviewStorage } from "./runtime/persistence.js";
import { initAnnotations } from "./runtime/annotations.js";
import { initFitb } from "./runtime/fitb.js";
import { initRecite } from "./runtime/recite.js";
import { initChoices } from "./runtime/choices.js";
import {
  activateTabPane,
  initCollapses,
  initReveal,
  initTabs,
  prepareRevealContext
} from "./runtime/disclosure.js";
import { initAudio } from "./runtime/audio.js";
import { createFloatingControlRuntime } from "./runtime/floating-control.js";
import {
  decodeAnkiFieldHtml,
  readAnkiFieldSource
} from "../shared/anki-field.js";
import {
  hasExcessiveMathDelimiters,
  protectMathPipes
} from "../shared/math.js";

(function (root, factory) {
  const api = factory(root || {});

  if (root) {
    root.myquizify = api;
    root.quizifyExtensions = api.quizifyExtensions;
    root.saveUserAnswers = api.saveUserAnswers;
    root.loadUserAnswers = api.loadUserAnswers;
    root.clearUserAnswers = api.clearUserAnswers;
    root.configureQuizifyMarked = api.configureQuizifyMarked;
    root.initAllQuizFeatures = api.initAllQuizFeatures;
    root.renderQuizify = api.renderQuizify;
    root.showQuizifyDependencyError = api.showQuizifyDependencyError;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function (root) {
  const state = {
    fitbCounter: 0,
    mcqCounter: 0,
    tabsCounter: 0,
    fieldPrefix: "",
    markdownRenderer: null,
    markedApi: null,
    usedIndependentMarked: false,
    revealControllers: []
  };
  const runtimeLifecycle = createLifecycle((error) => {
    root.console?.warn?.("Quizify cleanup failed", error);
  });
  const {
    canArmReciteTouchScrub,
    canReciteScrub,
    createQuizifyExtensions,
    createQuizifyRenderer,
    escapeHtml,
    isReciteScrubMove,
    markerStart,
    parseChoiceBlock,
    parseChoiceOptions,
    parseReciteBlock,
    parseReciteOptions,
    parseTabsBlock,
    tokenizeReciteText
  } = createMarkdownTools(state);
  const {
    clearReciteState,
    clearRevealProgress,
    clearUserAnswers,
    loadFloatingPosition,
    loadReciteState,
    loadRevealProgress,
    loadUserAnswers,
    saveFloatingPosition,
    saveReciteState,
    saveRevealProgress,
    saveUserAnswers
  } = createReviewStorage(root);


  function registerRevealController(controller) {
    if (!controller?.element || typeof controller.reveal !== "function") return;
    state.revealControllers.push(controller);
  }

  function configureQuizifyMarked(markedApi = root.marked) {
    if (!markedApi) return null;
    if (state.markdownRenderer && state.markedApi === markedApi) {
      return state.markdownRenderer;
    }

    const extensions = createQuizifyExtensions();
    const renderer = createQuizifyRenderer();

    function renderWithProtectedMath(parse, source) {
      const text = String(source ?? "");
      if (hasExcessiveMathDelimiters(text)) {
        return sanitizeRenderedHtml(
          '<p class="quizify-math-limit">公式定界符过多，已按纯文本显示以保护页面性能。</p>' +
            `<pre class="quizify-math-limit-source">${escapeHtml(text)}</pre>`
        );
      }
      const protectedMath = protectMathPipes(text);
      const html = parse(protectedMath.source);
      return sanitizeRenderedHtml(protectedMath.restore(html));
    }

    if (typeof markedApi.Marked === "function") {
      const instance = new markedApi.Marked();
      instance.use({ extensions, renderer });
      state.markdownRenderer = (source) =>
        renderWithProtectedMath((value) => instance.parse(value), source);
      state.markedApi = markedApi;
      state.usedIndependentMarked = true;
      return state.markdownRenderer;
    }

    if (typeof markedApi.use === "function" && typeof markedApi.parse === "function") {
      if (state.markedApi !== markedApi) {
        markedApi.use({ extensions, renderer });
      }
      state.markdownRenderer = (source) =>
        renderWithProtectedMath((value) => markedApi.parse(value), source);
      state.markedApi = markedApi;
      state.usedIndependentMarked = false;
      return state.markdownRenderer;
    }

    return null;
  }

  function readConfig() {
    const element = root.document?.getElementById("quizify-config");
    if (!element?.textContent) return {};

    try {
      return JSON.parse(element.textContent);
    } catch {
      return {};
    }
  }

  function normalizeReviewTheme(value) {
    return value === "gezhi" || value === "kaiwu" ? value : "kaiwu";
  }

  function applyConfig(config = readConfig()) {
    if (!root.document) return config;

    const theme = normalizeReviewTheme(config?.review?.theme);
    root.document.documentElement?.setAttribute("data-quizify-theme", theme);

    const containers = root.document.querySelectorAll(".container");
    containers.forEach((container) => {
      container.classList.toggle(
        "quizify-cardless",
        Boolean(config?.review?.cardless ?? config?.cardless)
      );
      container.setAttribute?.("data-quizify-theme", theme);
    });

    return config;
  }

  function initCodeBlocks() {
    if (!root.document) return;

    const labels = {
      bash: "Shell",
      cs: "C#",
      css: "CSS",
      html: "HTML",
      java: "Java",
      javascript: "JavaScript",
      js: "JavaScript",
      json: "JSON",
      jsx: "JSX",
      markdown: "Markdown",
      md: "Markdown",
      plaintext: "Text",
      python: "Python",
      py: "Python",
      shell: "Shell",
      sql: "SQL",
      ts: "TypeScript",
      tsx: "TSX",
      typescript: "TypeScript",
      xml: "XML",
      yaml: "YAML",
      yml: "YAML"
    };

    root.document.querySelectorAll("pre > code").forEach((code) => {
      const pre = code.parentElement;
      if (!pre) return;
      const languageClass = Array.from(code.classList || []).find((name) =>
        name.startsWith("language-")
      );
      const language = languageClass ? languageClass.slice(9).toLowerCase() : "";
      const label = labels[language] || (language ? language.toUpperCase() : "Code");
      pre.dataset.quizifyLanguage = label;
      pre.setAttribute("tabindex", "0");
      pre.setAttribute("aria-label", `${label} 代码块`);
    });
  }

  function showQuizifyDependencyError(name) {
    if (!root.document) return;

    root.document.querySelectorAll(".quizify-field").forEach((field) => {
      if (field.querySelector(".quizify-dependency-error")) return;

      const message = root.document.createElement("div");
      message.className = "quizify-dependency-error";
      message.textContent = `${name} 未加载，Quizify Markdown 暂时无法渲染。请在 Quizify 设置中校验并重新同步本地媒体后重试。`;
      field.prepend(message);
    });
  }

  function resetRenderState(prefix) {
    state.fitbCounter = 0;
    state.mcqCounter = 0;
    state.tabsCounter = 0;
    state.fieldPrefix = prefix || "";
  }

  function renderQuizify(selector) {
    if (!root.document) return;

    const field = root.document.querySelector(selector);
    if (!field) return;

    const renderer = state.markdownRenderer || configureQuizifyMarked();
    if (!renderer) {
      showQuizifyDependencyError("marked.js");
      return;
    }

    const source =
      typeof field.__quizifyMarkdownSource === "string"
        ? field.__quizifyMarkdownSource
        : readAnkiFieldSource(field, root.document);
    field.__quizifyMarkdownSource = source;
    const sourceBytes =
      typeof TextEncoder === "function"
        ? new TextEncoder().encode(source).byteLength
        : source.length * 2;
    if (sourceBytes > MAX_FIELD_BYTES) {
      field.textContent = "Quizify 无法渲染：当前字段超过 512 KiB 安全上限。";
      field.classList.add("quizify-render-error");
      return;
    }

    try {
      resetRenderState(`${field.id || "field"}-`);
      field.innerHTML = renderer(source);
      field.classList.remove("quizify-render-error");
    } catch (error) {
      field.textContent = `Quizify 渲染失败：${error?.message || "未知错误"}`;
      field.classList.add("quizify-render-error");
    }
  }

  function compareDocumentOrder(a, b) {
    if (a === b || typeof a?.compareDocumentPosition !== "function") return 0;
    const relation = a.compareDocumentPosition(b);
    if (relation & 2) return 1;
    if (relation & 4) return -1;
    return 0;
  }

  function finalizeRevealControllers() {
    const counters = {};
    state.revealControllers = state.revealControllers
      .filter((controller) => controller.element?.isConnected !== false)
      .sort((a, b) => compareDocumentOrder(a.element, b.element));

    state.revealControllers.forEach((controller) => {
      const field = controller.element.closest?.(".quizify-field");
      const fieldId = field?.id || "field";
      const index = counters[fieldId] || 0;
      counters[fieldId] = index + 1;
      controller.fieldId = fieldId;
      controller.id = `${fieldId}-reveal-${index}`;
      controller.element.dataset.quizifyRevealId = controller.id;
    });
  }

  function restoreRevealProgress() {
    const revealed = new Set(loadRevealProgress().revealed);
    state.revealControllers.forEach((controller) => {
      if (revealed.has(controller.id) && !controller.isRevealed?.()) {
        controller.reveal({ restore: true });
      }
    });
  }

  function sideRevealControllers() {
    const fieldId = root.isBack ? "back" : "front";
    return state.revealControllers.filter(
      (controller) => controller.fieldId === fieldId
    );
  }

  function persistCurrentRevealProgress(completed = false) {
    const previous = loadRevealProgress();
    const revealed = new Set(previous.revealed);
    state.revealControllers.forEach((controller) => {
      if (controller.isRevealed?.()) revealed.add(controller.id);
    });
    saveRevealProgress({
      revealed: Array.from(revealed),
      completed: Boolean(previous.completed || completed)
    });
  }

  function prefersReducedMotion() {
    return Boolean(root.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  }

  function afterLayout() {
    return new Promise((resolve) => {
      if (typeof root.requestAnimationFrame === "function") {
        root.requestAnimationFrame(() => root.requestAnimationFrame(resolve));
      } else {
        const schedule = root.setTimeout || setTimeout;
        schedule(resolve, 0);
      }
    });
  }

  async function focusRevealedController(controller) {
    const element = controller?.element;
    if (!element) return;
    await afterLayout();
    if (element.isConnected === false) return;
    element.classList.add("quizify-reveal-pulse");
    element.scrollIntoView?.({
      behavior:
        prefersReducedMotion() || controller.kind === "annotation"
          ? "auto"
          : "smooth",
      block: "center",
      inline: "nearest"
    });
    const schedule = root.setTimeout || setTimeout;
    schedule(() => element.classList.remove("quizify-reveal-pulse"), 720);
    if (typeof controller.afterFocus === "function") {
      schedule(() => {
        if (element.isConnected !== false) controller.afterFocus();
      }, 80);
    }
  }

  const {
    createFloatingController,
    directionFromDelta,
    easeForDirection,
    statusPlacementForCenter
  } = createFloatingControlRuntime({
    root,
    clearRevealProgress,
    clearUserAnswers,
    loadFloatingPosition,
    saveFloatingPosition,
    sideRevealControllers,
    persistCurrentRevealProgress,
    prepareRevealContext,
    focusRevealedController,
    prefersReducedMotion
  });

  function destroyQuizify() {
    runtimeLifecycle.dispose();
    root.quizifyFloatingControl?.destroy?.();
    root.quizifyFloatingControl = null;
    state.revealControllers = [];
  }

  function initAllQuizFeatures() {
    destroyQuizify();
    const config = applyConfig();
    initCodeBlocks();

    root.quizifyPlatform = createPlatform(config, root);

    // A new question side marks a new review cycle. Clear any state left by
    // the previous card, including cases where the user used Anki's native
    // answer buttons instead of the floating control.
    if (!root.isBack) {
      clearUserAnswers();
      clearRevealProgress();
      clearReciteState();
    }

    state.revealControllers = state.revealControllers.filter(
      (controller) => controller.element?.isConnected !== false
    );
    const userAnswers = loadUserAnswers();
    initFitb({
      root,
      lifecycle: runtimeLifecycle,
      userAnswers,
      saveUserAnswers,
      registerRevealController
    });
    initRecite({
      root,
      loadReciteState,
      saveReciteState,
      tokenizeReciteText,
      canReciteScrub,
      canArmReciteTouchScrub,
      isReciteScrubMove,
      registerRevealController,
      lifecycle: runtimeLifecycle
    });
    initTabs({ root, lifecycle: runtimeLifecycle });
    initCollapses({
      root,
      lifecycle: runtimeLifecycle,
      registerRevealController
    });
    initAudio({ root, lifecycle: runtimeLifecycle });
    initAnnotations({
      root,
      lifecycle: runtimeLifecycle,
      registerRevealController
    });
    initReveal({
      root,
      lifecycle: runtimeLifecycle,
      registerRevealController
    });
    initChoices({
      root,
      lifecycle: runtimeLifecycle,
      userAnswers,
      saveUserAnswers,
      registerRevealController
    });
    finalizeRevealControllers();
    restoreRevealProgress();
    root.quizifyFloatingControl = createFloatingController(config);
  }

  const api = {
    state,
    quizifyExtensions: createQuizifyExtensions(),
    configureQuizifyMarked,
    createQuizifyExtensions,
    createQuizifyRenderer,
    saveUserAnswers,
    loadUserAnswers,
    clearUserAnswers,
    initAllQuizFeatures,
    destroyQuizify,
    renderQuizify,
    showQuizifyDependencyError,
    _internal: {
      applyConfig,
      initCodeBlocks,
      configureQuizifyMarked,
      decodeAnkiFieldHtml,
      readAnkiFieldSource,
      escapeHtml,
      markerStart,
      parseChoiceOptions,
      parseChoiceBlock,
      parseTabsBlock,
      parseReciteBlock,
      parseReciteOptions,
      tokenizeReciteText,
      canReciteScrub,
      canArmReciteTouchScrub,
      isReciteScrubMove,
      activateTabPane,
      prepareRevealContext,
      directionFromDelta,
      easeForDirection,
      loadFloatingPosition,
      saveFloatingPosition,
      statusPlacementForCenter,
      readConfig,
      normalizeReviewTheme,
      resetRenderState,
      runtimeLifecycle
    }
  };

  return api;
});
