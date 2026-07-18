import { resolveRuntimeLifecycle } from "../lifecycle.js";

export function initAnnotations({ root, lifecycle = null, registerRevealController }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);

  root.document.querySelectorAll(".annotation").forEach((annotation) => {
    if (annotation.dataset.quizifyInitialized === "true") return;

    const tooltip = annotation.querySelector(".tooltip");
    if (!tooltip) return;
    annotation.dataset.quizifyInitialized = "true";

    function hide() {
      tooltip.style.opacity = 0;
      tooltip.style.visibility = "hidden";
    }

    function positionTooltip() {
      const annotationRect = annotation.getBoundingClientRect();
      tooltip.style.visibility = "hidden";
      tooltip.style.display = "block";
      tooltip.style.opacity = 0;

      let tooltipRect = tooltip.getBoundingClientRect();
      const pageWidth = root.innerWidth || 0;
      const defaultLeft = annotationRect.left + (annotationRect.width - tooltipRect.width) / 2;
      const adjustedLeft = Math.max(
        10,
        Math.min(defaultLeft, pageWidth - tooltipRect.width - 10)
      );
      tooltip.style.left = `${adjustedLeft}px`;
      tooltip.style.whiteSpace = "normal";
      tooltipRect = tooltip.getBoundingClientRect();

      let adjustedTop = annotationRect.top - tooltipRect.height - 10;
      if (adjustedTop < 0) {
        adjustedTop = annotationRect.bottom + 10;
        tooltip.style.setProperty("--tooltip-after-top", "-8px");
        tooltip.style.setProperty("--tooltip-after-bottom", "auto");
        tooltip.style.setProperty("--tooltip-after-border-top", "none");
        tooltip.style.setProperty(
          "--tooltip-after-border-bottom",
          "8px solid var(--tooltip-bg)"
        );
      } else {
        tooltip.style.setProperty("--tooltip-after-top", "auto");
        tooltip.style.setProperty("--tooltip-after-bottom", "-8px");
        tooltip.style.setProperty(
          "--tooltip-after-border-top",
          "8px solid var(--tooltip-bg)"
        );
        tooltip.style.setProperty("--tooltip-after-border-bottom", "none");
      }

      tooltip.style.top = `${adjustedTop}px`;
      tooltip.style.setProperty("--tooltip-after-left", `${defaultLeft - adjustedLeft}px`);
      tooltip.style.display = "";
    }

    function show() {
      positionTooltip();
      tooltip.style.visibility = "visible";
      tooltip.style.opacity = 1;
      annotation.classList.add("quizify-revealed");
    }

    const handleAnnotationClick = (event) => {
      event.stopPropagation();
      if (tooltip.style.visibility === "visible") {
        hide();
        return;
      }
      show();
    };
    const handleDocumentClick = (event) => {
      if (!annotation.contains(event.target)) hide();
    };

    activeLifecycle.listen(annotation, "click", handleAnnotationClick);
    activeLifecycle.listen(root.document, "click", handleDocumentClick);
    activeLifecycle.listen(root, "scroll", hide, true);
    activeLifecycle.listen(root, "resize", hide);
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
}
