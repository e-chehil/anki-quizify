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
  const viewportTarget = scope.getRootNode?.()?.host || scope;
  const root = {
    addEventListener: ownerWindow.addEventListener?.bind(ownerWindow),
    cancelAnimationFrame: ownerWindow.cancelAnimationFrame?.bind(ownerWindow),
    clearTimeout: ownerWindow.clearTimeout?.bind(ownerWindow),
    document: scopedDocument(scope),
    getComputedStyle: ownerWindow.getComputedStyle?.bind(ownerWindow),
    getQuizifyViewportRect() {
      const visualViewport = ownerWindow.visualViewport;
      const viewportLeft = Number(visualViewport?.offsetLeft) || 0;
      const viewportTop = Number(visualViewport?.offsetTop) || 0;
      const viewportWidth =
        Number(visualViewport?.width) || Number(ownerWindow.innerWidth) || 0;
      const viewportHeight =
        Number(visualViewport?.height) || Number(ownerWindow.innerHeight) || 0;
      const viewportRight = viewportLeft + viewportWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const targetRect = viewportTarget.getBoundingClientRect?.();
      if (!targetRect?.width || !targetRect?.height) {
        return {
          left: viewportLeft,
          top: viewportTop,
          right: viewportRight,
          bottom: viewportBottom,
          width: viewportWidth,
          height: viewportHeight
        };
      }

      const left = Math.max(viewportLeft, targetRect.left);
      const top = Math.max(viewportTop, targetRect.top);
      const right = Math.max(left, Math.min(viewportRight, targetRect.right));
      const bottom = Math.max(top, Math.min(viewportBottom, targetRect.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    },
    isBack,
    navigator: ownerWindow.navigator,
    quizifyViewportTarget: viewportTarget,
    removeEventListener: ownerWindow.removeEventListener?.bind(ownerWindow),
    requestAnimationFrame: ownerWindow.requestAnimationFrame?.bind(ownerWindow),
    setTimeout: ownerWindow.setTimeout?.bind(ownerWindow)
  };
  Object.defineProperties(root, {
    innerHeight: {
      enumerable: true,
      get: () => Number(ownerWindow.innerHeight) || 0
    },
    innerWidth: {
      enumerable: true,
      get: () => Number(ownerWindow.innerWidth) || 0
    },
    visualViewport: {
      enumerable: true,
      get: () => ownerWindow.visualViewport
    }
  });
  return root;
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
