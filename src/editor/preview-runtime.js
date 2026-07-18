import { createLifecycle } from "../review/lifecycle.js";
import { initAnnotations } from "../review/runtime/annotations.js";
import { initAudio } from "../review/runtime/audio.js";
import { initChoices } from "../review/runtime/choices.js";
import {
  initCollapses,
  initReveal,
  initTabs
} from "../review/runtime/disclosure.js";
import { initFitb } from "../review/runtime/fitb.js";
import { initRecite } from "../review/runtime/recite.js";

const activePreviews = new WeakMap();

function scopedDocument(scope) {
  const owner = scope.ownerDocument || document;
  return {
    addEventListener: owner.addEventListener?.bind(owner),
    createDocumentFragment: () => owner.createDocumentFragment(),
    createElement: (name) => owner.createElement(name),
    createTextNode: (value) => owner.createTextNode(value),
    elementFromPoint: (...args) => owner.elementFromPoint?.(...args) || null,
    querySelectorAll: (selector) => scope.querySelectorAll(selector),
    removeEventListener: owner.removeEventListener?.bind(owner)
  };
}

function previewRoot(scope, isBack) {
  const ownerWindow = scope.ownerDocument?.defaultView || globalThis;
  return {
    addEventListener: ownerWindow.addEventListener?.bind(ownerWindow),
    clearTimeout: ownerWindow.clearTimeout?.bind(ownerWindow),
    document: scopedDocument(scope),
    getComputedStyle: ownerWindow.getComputedStyle?.bind(ownerWindow),
    innerWidth: Math.max(scope.clientWidth || 0, ownerWindow.innerWidth || 0),
    isBack,
    navigator: ownerWindow.navigator,
    removeEventListener: ownerWindow.removeEventListener?.bind(ownerWindow),
    setTimeout: ownerWindow.setTimeout?.bind(ownerWindow)
  };
}

function parserTools() {
  const tools = globalThis.myquizify?._internal || {};
  return {
    canArmReciteTouchScrub:
      tools.canArmReciteTouchScrub || ((pointerType) => pointerType === "touch"),
    canReciteScrub:
      tools.canReciteScrub || ((pointerType, button) => pointerType !== "touch" && button === 0),
    isReciteScrubMove:
      tools.isReciteScrubMove || ((deltaX, deltaY) => Math.hypot(deltaX, deltaY) > 10),
    tokenizeReciteText: tools.tokenizeReciteText || ((text) => [{ text, hideable: false }])
  };
}

export function disposePreviewInteractions(scope) {
  const active = activePreviews.get(scope);
  if (!active) return;
  active.lifecycle.dispose();
  scope.querySelectorAll("audio").forEach((audio) => audio.pause?.());
  activePreviews.delete(scope);
}

export function initPreviewInteractions(scope, { isBack = false } = {}) {
  if (!scope) return () => {};
  disposePreviewInteractions(scope);

  const root = previewRoot(scope, isBack);
  const lifecycle = createLifecycle();
  const userAnswers = { fitbs: {}, mcqs: {} };
  const reciteState = {};
  const registerRevealController = () => {};
  const saveUserAnswers = () => {};

  initFitb({
    root,
    lifecycle,
    userAnswers,
    saveUserAnswers,
    registerRevealController
  });
  initRecite({
    root,
    loadReciteState: () => reciteState,
    saveReciteState: () => {},
    ...parserTools(),
    registerRevealController,
    lifecycle
  });
  initTabs({ root, lifecycle });
  initCollapses({ root, lifecycle, registerRevealController });
  initAudio({ root, lifecycle });
  initAnnotations({ root, lifecycle, registerRevealController });
  initReveal({ root, lifecycle, registerRevealController });
  initChoices({
    root,
    lifecycle,
    userAnswers,
    saveUserAnswers,
    registerRevealController
  });

  activePreviews.set(scope, { lifecycle });
  return () => disposePreviewInteractions(scope);
}
