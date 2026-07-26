import "./orchestrator.js";
import { katex, markedApi } from "./dependencies.js";
import { highlightCodeElement } from "./code.js";
import { enhanceOutlineLists } from "./outline.js";
import { enhanceMarkdownTables } from "./tables.js";
import { renderMathPlaceholders } from "../shared/math.js";

const legacy = globalThis.myquizify;

function renderSide(side) {
  if (side === "back") {
    legacy.renderQuizify("#front");
    legacy.renderQuizify("#back");
  } else {
    legacy.renderQuizify("#front");
  }
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
  destroy();
  globalThis.isBack = side === "back";
  legacy.configureQuizifyMarked(markedApi);
  renderSide(side);
  document.querySelectorAll(".quizify-field").forEach((field) => {
    enhanceOutlineLists(field);
    enhanceMarkdownTables(field);
  });
  enhanceCode();
  enhanceMath();
  legacy.initAllQuizFeatures();
  api.platform = globalThis.quizifyPlatform;
  return api;
}

const api = {
  version: "1.1.0",
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
