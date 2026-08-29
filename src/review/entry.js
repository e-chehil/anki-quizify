import "./orchestrator.js";
import { katex, markedApi } from "./dependencies.js";
import { highlightCodeElement } from "./code.js";
import { enhanceOutlineLists } from "./outline.js";
import { enhanceMarkdownTables } from "./tables.js";
import { renderMathPlaceholders } from "../shared/math.js";
import { localizeDocument } from "../shared/i18n.js";

// Mobile/preview clients can evaluate the bundle for every card side. Clean
// up the previous instance before the new module graph replaces its globals.
globalThis.Quizify?.destroy?.();
const legacy = globalThis.myquizify;

function renderSide(side) {
  if (side === "back") {
    legacy.renderQuizify("#front");
    legacy.renderQuizify("#back");
  } else {
    legacy.renderQuizify("#front");
  }
}

function applyContentDirection() {
  document
    .querySelectorAll(
      ".quizify-field, .quizify-deck > span:last-child, .quizify-tags"
    )
    .forEach((element) => element.setAttribute("dir", "auto"));
}

function enhanceCode() {
  document.querySelectorAll("pre > code").forEach((code) => {
    try {
      highlightCodeElement(code);
    } catch (error) {
      console.warn("Quizify code highlighting failed", error);
    }
  });
}

function enhanceMath() {
  const host = document.getElementById("note-container");
  if (!host) return;
  try {
    renderMathPlaceholders(host, katex);
  } catch (error) {
    console.warn("Quizify math rendering failed", error);
  }
}

function destroy() {
  legacy.destroyQuizify?.();
}

function boot({ side = "front" } = {}) {
  try {
    destroy();
    globalThis.isBack = side === "back";
    localizeDocument(document);
    legacy.configureQuizifyMarked(markedApi);
    const config = legacy._internal.applyConfig();
    renderSide(side);
    applyContentDirection();
    document.querySelectorAll(".quizify-field").forEach((field) => {
      enhanceOutlineLists(field);
      enhanceMarkdownTables(field);
    });
    enhanceCode();
    enhanceMath();
    legacy.initAllQuizFeatures(config);
    api.platform = globalThis.quizifyPlatform;
    return api;
  } finally {
    globalThis.__quizifyFirstPaint?.reveal?.();
  }
}

const api = {
  version: "1.2.2",
  boot,
  destroy,
  enhanceOutlineLists,
  enhanceMarkdownTables,
  platform: null,
  renderMarkdown(source) {
    const renderer = legacy.configureQuizifyMarked(markedApi);
    legacy._internal.resetRenderState("preview-");
    return renderer(String(source ?? ""));
  }
};

globalThis.Quizify = api;
