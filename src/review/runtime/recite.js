import { resolveRuntimeLifecycle } from "../lifecycle.js";
import { t } from "../../shared/i18n.js";

export const MAX_RECITE_TOKENS = 2000;

export function initRecite({
  root,
  loadReciteState,
  saveReciteState,
  tokenizeReciteText,
  canReciteScrub,
  canArmReciteTouchScrub,
  isReciteScrubMove,
  registerRevealController,
  lifecycle = null
}) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);
  const savedState = loadReciteState();
  const excluded = [
    "a",
    "img",
    "svg",
    "math",
    "code",
    "pre",
    "script",
    "style",
    "textarea",
    "input",
    "button",
    "select",
    "option",
    ".fitb",
    ".choice",
    ".reveal",
    ".annotation",
    ".audio-player",
    ".quizify-math",
    ".katex",
    ".quizify-recite-toolbar"
  ].join(",");

  root.document.querySelectorAll(".quizify-recite").forEach((block, blockIndex) => {
    if (block.dataset.quizifyInitialized === "true") return;
    const content = block.querySelector(".quizify-recite-content");
    const slider = block.querySelector('.quizify-recite-toolbar input[type="range"]');
    const output = block.querySelector(".quizify-recite-toolbar output");
    const shuffle = block.querySelector(".quizify-recite-shuffle");
    if (!content || !slider || !output || !shuffle) return;
    block.dataset.quizifyInitialized = "true";
    if (!block.dataset.scrubLabel) {
      block.dataset.scrubLabel = t("review.recite.scrub_hint");
    }

    const mode = ["auto", "manual", "mixed"].includes(block.dataset.mode)
      ? block.dataset.mode
      : "mixed";
    const field = block.closest?.(".quizify-field");
    const blockId = `${field?.id || "field"}-recite-${blockIndex}`;
    const textNodes = [];

    function collectTextNodes(node) {
      Array.from(node?.childNodes || []).forEach((child) => {
        if (child.nodeType === 3) {
          textNodes.push(child);
          return;
        }
        if (child.nodeType !== 1) return;
        if (child !== content && child.matches?.(excluded)) return;
        if (child.classList?.contains("quizify-recite") && child !== block) return;
        collectTextNodes(child);
      });
    }

    let tokenIndex = 0;
    const ownsToken = (token) => token.closest?.(".quizify-recite") === block;
    let existingTokens = Array.from(
      block.querySelectorAll(".quizify-recite-token")
    ).filter(ownsToken);
    if (existingTokens.length > MAX_RECITE_TOKENS) {
      existingTokens.slice(MAX_RECITE_TOKENS).forEach((token) => {
        token.replaceWith(root.document.createTextNode(token.textContent || ""));
      });
      existingTokens = existingTokens.slice(0, MAX_RECITE_TOKENS);
      block.dataset.quizifyTokenCapped = "true";
    }

    if (!existingTokens.length) {
      delete block.dataset.quizifyTokenCapped;
      collectTextNodes(content);
      textNodes.forEach((node) => {
        const parts = tokenizeReciteText(node.nodeValue, mode);
        if (!parts.some((part) => part.hideable) && !String(node.nodeValue).includes("%%")) {
          return;
        }
        const fragment = root.document.createDocumentFragment();
        let plainText = "";
        const flushPlainText = () => {
          if (!plainText) return;
          fragment.appendChild(root.document.createTextNode(plainText));
          plainText = "";
        };
        for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
          const part = parts[partIndex];
          if (!part.hideable) {
            plainText += part.text;
            continue;
          }
          if (tokenIndex >= MAX_RECITE_TOKENS) {
            plainText += parts.slice(partIndex).map((item) => item.text).join("");
            block.dataset.quizifyTokenCapped = "true";
            break;
          }
          flushPlainText();
          const span = root.document.createElement("span");
          span.className = `quizify-recite-token${part.manual ? " quizify-recite-manual" : ""}`;
          span.textContent = part.text;
          span.tabIndex = 0;
          span.setAttribute("role", "button");
          span.dataset.reciteIndex = String(tokenIndex++);
          span.setAttribute(
            "aria-label",
            t("review.recite.unit", { text: part.text })
          );
          fragment.appendChild(span);
        }
        flushPlainText();
        node.parentNode?.replaceChild(fragment, node);
      });
    }

    const tokens = Array.from(block.querySelectorAll(".quizify-recite-token"))
      .filter(ownsToken)
      .slice(0, MAX_RECITE_TOKENS);
    tokens.forEach((token, index) => {
      token.dataset.reciteIndex = String(index);
    });
    function maskedIndices() {
      return tokens
        .filter((token) => token.classList.contains("masked"))
        .map((token) => Number(token.dataset.reciteIndex));
    }
    function persistBlock() {
      savedState[blockId] = {
        mask: Number(slider.value),
        masked: maskedIndices()
      };
      saveReciteState(savedState);
    }
    function setMasked(token, masked, persist = true, markRevealed = true) {
      token.classList.toggle("masked", masked);
      token.classList.toggle("revealed", !masked && markRevealed);
      token.setAttribute("aria-pressed", masked ? "false" : "true");
      if (persist) persistBlock();
    }
    function applyMaskSet(indices, persist = true) {
      const selected = new Set(indices);
      tokens.forEach((token) => {
        setMasked(token, selected.has(Number(token.dataset.reciteIndex)), false, false);
      });
      output.textContent = `${Number(slider.value)}%`;
      if (persist) persistBlock();
    }
    function reshuffle() {
      const indices = tokens.map((token) => Number(token.dataset.reciteIndex));
      for (let index = indices.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [indices[index], indices[other]] = [indices[other], indices[index]];
      }
      const ratio = Math.max(0, Math.min(100, Number(slider.value))) / 100;
      const count =
        ratio > 0 && indices.length ? Math.max(1, Math.round(indices.length * ratio)) : 0;
      applyMaskSet(indices.slice(0, count));
    }
    function revealNext() {
      const token = tokens.find((item) => item.classList.contains("masked"));
      if (token) setMasked(token, false);
    }
    function revealAll() {
      applyMaskSet([]);
    }

    const scrub = {
      active: false,
      changed: false,
      didScrub: false,
      longPressed: false,
      moved: false,
      pointerId: null,
      pointerType: "",
      startToken: null,
      startX: 0,
      startY: 0,
      timer: null
    };

    function tokenFromTarget(target) {
      const token = target?.closest?.(".quizify-recite-token");
      return token && ownsToken(token) ? token : null;
    }
    function canScrub(event) {
      return canReciteScrub(
        event.pointerType,
        event.button === undefined ? 0 : event.button
      );
    }
    function revealScrubToken(token) {
      if (!token?.classList?.contains("masked")) return;
      setMasked(token, false, false);
      scrub.changed = true;
    }
    function scrubTokenAtPoint(x, y) {
      const hit = root.document.elementFromPoint?.(x, y);
      return tokenFromTarget(hit);
    }
    function cancelTimer() {
      if (scrub.timer !== null) {
        const cancel = root.clearTimeout || clearTimeout;
        cancel.call(root, scrub.timer);
        scrub.timer = null;
      }
    }
    function finishScrub() {
      const shouldPersist = scrub.active;
      scrub.active = false;
      block.dataset.scrubbing = "false";
      tokens.forEach((token) => token.classList.remove("peeking"));
      if (shouldPersist) {
        if (scrub.changed) persistBlock();
      }
      scrub.changed = false;
    }
    function updateScrubAt(x, y) {
      const movedEnough = isReciteScrubMove(x - scrub.startX, y - scrub.startY);
      if (!scrub.didScrub && !movedEnough) return false;
      if (!scrub.didScrub) {
        scrub.didScrub = true;
        block.dataset.scrubbing = "true";
        revealScrubToken(scrub.startToken);
      }
      revealScrubToken(scrubTokenAtPoint(x, y));
      return true;
    }

    function endPointer(cancelled = false) {
      const startToken = scrub.startToken;
      cancelTimer();
      startToken?.classList.remove("peeking");
      if (
        !cancelled &&
        startToken &&
        !scrub.moved &&
        !scrub.longPressed &&
        !scrub.didScrub
      ) {
        setMasked(startToken, !startToken.classList.contains("masked"));
      }
      finishScrub();
      scrub.pointerId = null;
      scrub.pointerType = "";
      scrub.startToken = null;
    }

    activeLifecycle.listen(block, "pointerdown", (event) => {
      const token = tokenFromTarget(event.target);
      if (!token || (event.button !== undefined && event.button !== 0)) return;
      cancelTimer();
      scrub.active = canScrub(event);
      scrub.changed = false;
      scrub.didScrub = false;
      scrub.longPressed = false;
      scrub.moved = false;
      scrub.pointerId = event.pointerId;
      scrub.pointerType = String(event.pointerType || "mouse").toLowerCase();
      scrub.startToken = token;
      scrub.startX = event.clientX;
      scrub.startY = event.clientY;
      const schedule = root.setTimeout || setTimeout;
      scrub.timer = schedule.call(root, () => {
        scrub.timer = null;
        scrub.longPressed = true;
        if (token.classList.contains("masked")) token.classList.add("peeking");
        if (canArmReciteTouchScrub(scrub.pointerType)) {
          scrub.active = true;
          block.dataset.scrubbing = "armed";
          root.navigator?.vibrate?.(18);
        }
      }, canArmReciteTouchScrub(scrub.pointerType) ? 380 : 320);
    });
    activeLifecycle.listen(block, "pointermove", (event) => {
      if (scrub.pointerId === null || event.pointerId !== scrub.pointerId) return;
      if (Math.hypot(event.clientX - scrub.startX, event.clientY - scrub.startY) > 10) {
        scrub.moved = true;
        cancelTimer();
        scrub.startToken?.classList.remove("peeking");
      }
      if (scrub.pointerType === "touch" || !scrub.active) return;
      if (updateScrubAt(event.clientX, event.clientY)) event.preventDefault?.();
    });
    activeLifecycle.listen(
      block,
      "touchmove",
      (event) => {
        if (!scrub.active || scrub.pointerType !== "touch") return;
        const touch = event.touches?.[0];
        if (!touch) return;
        if (updateScrubAt(touch.clientX, touch.clientY)) event.preventDefault();
      },
      { passive: false }
    );
    activeLifecycle.listen(block, "pointerup", (event) => {
      if (scrub.pointerId === null || event.pointerId !== scrub.pointerId) return;
      endPointer(false);
    });
    activeLifecycle.listen(block, "pointercancel", (event) => {
      if (scrub.pointerId === null || event.pointerId !== scrub.pointerId) return;
      endPointer(true);
    });
    activeLifecycle.listen(block, "pointerleave", (event) => {
      if (scrub.pointerId === null || event.pointerId !== scrub.pointerId) return;
      endPointer(true);
    });
    activeLifecycle.listen(block, "touchend", () => {
      if (scrub.pointerType === "touch" && scrub.pointerId !== null) endPointer(false);
    });
    activeLifecycle.listen(block, "touchcancel", () => {
      if (scrub.pointerType === "touch" && scrub.pointerId !== null) endPointer(true);
    });
    activeLifecycle.listen(block, "contextmenu", (event) => {
      if (tokenFromTarget(event.target)) event.preventDefault();
    });
    activeLifecycle.listen(block, "keydown", (event) => {
      const token = tokenFromTarget(event.target);
      if (!token || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      setMasked(token, !token.classList.contains("masked"));
    });

    const saved = savedState[blockId];
    if (saved && Array.isArray(saved.masked)) {
      const restoredMask = Math.max(0, Math.min(100, Number(saved.mask)));
      slider.value = Number.isFinite(restoredMask) ? String(restoredMask) : slider.value;
      applyMaskSet(saved.masked, false);
    } else {
      reshuffle();
    }
    activeLifecycle.listen(slider, "input", () => {
      output.textContent = `${Number(slider.value)}%`;
      reshuffle();
    });
    activeLifecycle.listen(shuffle, "click", reshuffle);
    activeLifecycle.add(() => {
      cancelTimer();
      finishScrub();
      delete block.dataset.quizifyInitialized;
      delete block.dataset.scrubbing;
    });

    if (tokens.length) {
      registerRevealController({
        kind: "recite",
        element: block,
        isRevealed: () => !tokens.some((token) => token.classList.contains("masked")),
        reveal: (options) => (options?.restore ? revealAll() : revealNext())
      });
    }
  });
}
