import { resolveRuntimeLifecycle } from "../lifecycle.js";
import { t } from "../../shared/i18n.js";

const TOOLTIP_MARGIN = 10;
const TOOLTIP_GAP = 10;
const TOOLTIP_ARROW_EDGE = 18;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeRect(rect = {}, fallback = {}) {
  const left = finiteNumber(rect.left, finiteNumber(fallback.left));
  const top = finiteNumber(rect.top, finiteNumber(fallback.top));
  const width = Math.max(
    0,
    finiteNumber(
      rect.width,
      finiteNumber(rect.right, left) - left || finiteNumber(fallback.width)
    )
  );
  const height = Math.max(
    0,
    finiteNumber(
      rect.height,
      finiteNumber(rect.bottom, top) - top || finiteNumber(fallback.height)
    )
  );
  return {
    left,
    top,
    right: finiteNumber(rect.right, left + width),
    bottom: finiteNumber(rect.bottom, top + height),
    width,
    height
  };
}

function viewportRect(root) {
  const customRect = root.getQuizifyViewportRect?.();
  if (customRect) return normalizeRect(customRect);

  const visualViewport = root.visualViewport;
  const left = finiteNumber(visualViewport?.offsetLeft);
  const top = finiteNumber(visualViewport?.offsetTop);
  const width = Math.max(
    0,
    finiteNumber(
      visualViewport?.width,
      finiteNumber(root.innerWidth, root.document?.documentElement?.clientWidth)
    )
  );
  const height = Math.max(
    0,
    finiteNumber(
      visualViewport?.height,
      finiteNumber(root.innerHeight, root.document?.documentElement?.clientHeight)
    )
  );
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

export function computeTooltipPlacement(
  anchorRect,
  tooltipRect,
  boundaryRect,
  { margin = TOOLTIP_MARGIN, gap = TOOLTIP_GAP } = {}
) {
  const anchor = normalizeRect(anchorRect);
  const tooltip = normalizeRect(tooltipRect);
  const boundary = normalizeRect(boundaryRect);
  const innerLeft = boundary.left + margin;
  const innerTop = boundary.top + margin;
  const innerRight = Math.max(innerLeft, boundary.right - margin);
  const innerBottom = Math.max(innerTop, boundary.bottom - margin);
  const width = Math.min(tooltip.width, Math.max(0, innerRight - innerLeft));
  const height = Math.min(tooltip.height, Math.max(0, innerBottom - innerTop));
  const anchorCenter = anchor.left + anchor.width / 2;
  const left = clamp(anchorCenter - width / 2, innerLeft, innerRight - width);
  const spaceAbove = Math.max(0, anchor.top - gap - innerTop);
  const spaceBelow = Math.max(0, innerBottom - anchor.bottom - gap);
  const placement =
    spaceAbove >= height || (spaceAbove >= spaceBelow && spaceBelow < height)
      ? "top"
      : "bottom";
  const availableHeight = placement === "top" ? spaceAbove : spaceBelow;
  const visibleHeight = Math.min(height, availableHeight);
  const top =
    placement === "top"
      ? clamp(anchor.top - gap - visibleHeight, innerTop, innerBottom - visibleHeight)
      : clamp(anchor.bottom + gap, innerTop, innerBottom - visibleHeight);
  const arrowEdge = Math.min(TOOLTIP_ARROW_EDGE, width / 2);
  const arrowLeft = clamp(anchorCenter - left, arrowEdge, width - arrowEdge);

  return {
    left,
    top,
    width,
    height: visibleHeight,
    maxHeight: availableHeight,
    placement,
    arrowLeft
  };
}

export function initAnnotations({ root, lifecycle = null, registerRevealController }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);
  const annotations = Array.from(root.document.querySelectorAll(".annotation"));
  const items = [];
  let activeItem = null;

  annotations.forEach((annotation) => {
    if (annotation.dataset.quizifyInitialized === "true") return;

    const tooltip = annotation.querySelector(".tooltip");
    if (!tooltip) return;
    annotation.dataset.quizifyInitialized = "true";

    let positionFrame = null;
    const cancelPositionFrame = () => {
      if (positionFrame === null || typeof root.cancelAnimationFrame !== "function") return;
      root.cancelAnimationFrame(positionFrame);
      positionFrame = null;
    };

    function hide() {
      cancelPositionFrame();
      tooltip.style.opacity = 0;
      tooltip.style.visibility = "hidden";
      tooltip.setAttribute?.("aria-hidden", "true");
      annotation.setAttribute?.("aria-expanded", "false");
      const actionLabel = t("review.annotation.show");
      annotation.setAttribute?.("aria-label", actionLabel);
      annotation.title = actionLabel;
      if (activeItem?.annotation === annotation) activeItem = null;
    }

    function positionTooltip() {
      const boundary = viewportRect(root);
      const annotationRect = normalizeRect(annotation.getBoundingClientRect());
      if (
        boundary.width <= 0 ||
        boundary.height <= 0 ||
        annotationRect.bottom < boundary.top ||
        annotationRect.top > boundary.bottom ||
        annotationRect.right < boundary.left ||
        annotationRect.left > boundary.right
      ) {
        return false;
      }

      const maximumWidth = Math.max(0, boundary.width - TOOLTIP_MARGIN * 2);
      const maximumHeight = Math.max(0, boundary.height - TOOLTIP_MARGIN * 2);
      tooltip.style.visibility = "hidden";
      tooltip.style.opacity = 0;
      tooltip.style.left = `${boundary.left + TOOLTIP_MARGIN}px`;
      tooltip.style.top = `${boundary.top + TOOLTIP_MARGIN}px`;
      tooltip.style.right = "auto";
      tooltip.style.bottom = "auto";
      tooltip.style.maxWidth = `${maximumWidth}px`;
      tooltip.style.maxHeight = `${maximumHeight}px`;
      tooltip.style.removeProperty("--tooltip-arrow-left");
      tooltip.removeAttribute("data-placement");

      const firstRect = normalizeRect(tooltip.getBoundingClientRect());
      const firstPlacement = computeTooltipPlacement(
        annotationRect,
        firstRect,
        boundary
      );
      tooltip.style.maxHeight = `${Math.max(0, firstPlacement.maxHeight)}px`;

      const finalRect = normalizeRect(tooltip.getBoundingClientRect());
      const placement = computeTooltipPlacement(
        annotationRect,
        finalRect,
        boundary
      );
      tooltip.style.left = `${placement.left}px`;
      tooltip.style.top = `${placement.top}px`;
      tooltip.style.setProperty("--tooltip-arrow-left", `${placement.arrowLeft}px`);
      tooltip.dataset.placement = placement.placement;
      return true;
    }

    function show() {
      if (activeItem && activeItem.annotation !== annotation) activeItem.hide();
      activeItem = item;
      if (!positionTooltip()) {
        hide();
        return;
      }
      tooltip.style.visibility = "visible";
      tooltip.style.opacity = 1;
      tooltip.setAttribute?.("aria-hidden", "false");
      annotation.setAttribute?.("aria-expanded", "true");
      const actionLabel = t("review.annotation.hide");
      annotation.setAttribute?.("aria-label", actionLabel);
      annotation.title = actionLabel;
      annotation.classList.add("quizify-revealed");

      if (typeof root.requestAnimationFrame === "function") {
        positionFrame = root.requestAnimationFrame(() => {
          positionFrame = null;
          if (activeItem?.annotation !== annotation) return;
          if (!positionTooltip()) {
            hide();
            return;
          }
          tooltip.style.visibility = "visible";
          tooltip.style.opacity = 1;
        });
      }
    }

    const item = { annotation, tooltip, hide, positionTooltip, show };
    items.push(item);

    const handleAnnotationClick = (event) => {
      if (tooltip.contains(event.target)) {
        event.stopPropagation();
        return;
      }
      const nestedInteractive = event.target?.closest?.(
        "a, button, input, select, textarea"
      );
      if (nestedInteractive && nestedInteractive !== annotation) return;
      event.stopPropagation();
      if (annotation.getAttribute?.("aria-expanded") === "true") {
        hide();
        return;
      }
      show();
    };

    activeLifecycle.listen(annotation, "click", handleAnnotationClick);
    activeLifecycle.listen(annotation, "keydown", (event) => {
      if (event.target !== annotation) return;
      if (event.key === "Escape") {
        event.preventDefault();
        hide();
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      handleAnnotationClick(event);
    });
    activeLifecycle.add(() => {
      delete annotation.dataset.quizifyInitialized;
      hide();
    });
    registerRevealController({
      kind: "annotation",
      element: annotation,
      isRevealed: () => annotation.classList.contains("quizify-revealed"),
      reveal: () => annotation.classList.add("quizify-revealed"),
      afterFocus: show
    });
  });

  if (!items.length) return;
  const hideActive = () => activeItem?.hide();
  activeLifecycle.listen(root.document, "click", (event) => {
    if (activeItem && !activeItem.annotation.contains(event.target)) hideActive();
  });
  activeLifecycle.listen(root, "scroll", hideActive, true);
  activeLifecycle.listen(root, "resize", hideActive);
  activeLifecycle.listen(root.visualViewport, "scroll", hideActive);
  activeLifecycle.listen(root.visualViewport, "resize", hideActive);
  if (root.quizifyViewportTarget && root.quizifyViewportTarget !== root) {
    activeLifecycle.listen(root.quizifyViewportTarget, "scroll", hideActive);
  }
  activeLifecycle.add(hideActive);
}
