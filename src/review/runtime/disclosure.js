import { resolveRuntimeLifecycle } from "../lifecycle.js";
import { t } from "../../shared/i18n.js";

export function activateTabPane(pane) {
  const content = pane?.parentElement;
  const tabGroup = content?.closest?.(".tabs-container");
  if (!content || !tabGroup) return false;

  const panes = Array.from(content.children || []).filter((element) =>
    element.classList?.contains("tab-pane")
  );
  const index = panes.indexOf(pane);
  const navigation = Array.from(tabGroup.children || []).find((element) =>
    element.classList?.contains("tabs-nav")
  );
  const buttons = Array.from(navigation?.children || []).filter((element) =>
    element.classList?.contains("tab-button")
  );
  if (index < 0 || !buttons[index]) return false;

  buttons.forEach((button) => {
    button.classList.remove("active");
    button.setAttribute?.("aria-selected", "false");
    button.setAttribute?.("tabindex", "-1");
  });
  panes.forEach((item) => {
    item.classList.remove("active");
    item.setAttribute?.("aria-hidden", "true");
  });
  buttons[index].classList.add("active");
  buttons[index].setAttribute?.("aria-selected", "true");
  buttons[index].setAttribute?.("tabindex", "0");
  pane.classList.add("active");
  pane.setAttribute?.("aria-hidden", "false");
  return true;
}

export function prepareRevealContext(controller) {
  const contexts = [];
  let ancestor = controller?.element?.parentElement;
  while (ancestor) {
    const tagName = String(ancestor.tagName || "").toLowerCase();
    if (tagName === "details" || ancestor.classList?.contains("tab-pane")) {
      contexts.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }

  contexts.reverse().forEach((context) => {
    if (String(context.tagName || "").toLowerCase() === "details") {
      context.open = true;
      context.classList?.add("quizify-revealed");
    } else if (context.classList?.contains("tab-pane")) {
      activateTabPane(context);
    }
  });
}

export function initTabs({ root, lifecycle = null }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);
  root.document.querySelectorAll(".tabs-container").forEach((tabGroup) => {
    if (tabGroup.dataset.quizifyInitialized === "true") return;
    const navigation = Array.from(tabGroup.children || []).find((element) =>
      element.classList?.contains("tabs-nav")
    );
    const content = Array.from(tabGroup.children || []).find((element) =>
      element.classList?.contains("tabs-content")
    );
    const buttons = Array.from(navigation?.children || []).filter((element) =>
      element.classList?.contains("tab-button")
    );
    const panes = Array.from(content?.children || []).filter((element) =>
      element.classList?.contains("tab-pane")
    );
    if (!buttons.length || !panes.length) return;
    tabGroup.dataset.quizifyInitialized = "true";

    buttons.forEach((button, index) => {
      activeLifecycle.listen(button, "click", () => {
        if (panes[index]) activateTabPane(panes[index]);
      });
      activeLifecycle.listen(button, "keydown", (event) => {
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          nextIndex = (index + 1) % buttons.length;
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          nextIndex = (index - 1 + buttons.length) % buttons.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = buttons.length - 1;
        } else if (event.key === "Enter" || event.key === " ") {
          nextIndex = index;
        }
        if (nextIndex === null || !panes[nextIndex]) return;
        event.preventDefault();
        activateTabPane(panes[nextIndex]);
        buttons[nextIndex].focus?.();
      });
    });
    activeLifecycle.add(() => {
      delete tabGroup.dataset.quizifyInitialized;
    });
  });
}

export function initCollapses({ root, registerRevealController, lifecycle = null }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);
  root.document.querySelectorAll(".quizify-field details").forEach((details) => {
    if (details.dataset.quizifyRevealInitialized === "true") return;
    details.dataset.quizifyRevealInitialized = "true";
    activeLifecycle.listen(details, "toggle", () => {
      details.classList.toggle("quizify-revealed", details.open);
    });
    activeLifecycle.add(() => {
      delete details.dataset.quizifyRevealInitialized;
    });
    registerRevealController({
      kind: "collapse",
      element: details,
      isRevealed: () => details.open,
      reveal: () => {
        details.open = true;
        details.classList.add("quizify-revealed");
      }
    });
  });
}

export function initReveal({ root, registerRevealController, lifecycle = null }) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);
  root.document.querySelectorAll(".reveal").forEach((element) => {
    if (element.dataset.quizifyInitialized === "true") return;
    const secret = element.querySelector(".secret");
    if (!secret) return;
    element.dataset.quizifyInitialized = "true";
    secret.style.display = "none";
    element.classList.remove("active");

    function setRevealed(show) {
      secret.style.display = show ? "inline" : "none";
      secret.setAttribute?.("aria-hidden", show ? "false" : "true");
      element.setAttribute?.("aria-expanded", show ? "true" : "false");
      const actionLabel = t(show ? "review.reveal.hide" : "review.reveal.show");
      element.setAttribute?.("aria-label", actionLabel);
      element.title = actionLabel;
      element.classList.toggle("active", show);
      element.classList.toggle("quizify-revealed", show);
    }
    activeLifecycle.listen(element, "click", (event) => {
      const nestedInteractive = event.target?.closest?.(
        "a, button, input, select, textarea"
      );
      if (nestedInteractive && nestedInteractive !== element) return;
      setRevealed(secret.style.display !== "inline");
    });
    activeLifecycle.listen(element, "keydown", (event) => {
      if (
        event.target !== element ||
        (event.key !== "Enter" && event.key !== " ")
      ) {
        return;
      }
      event.preventDefault();
      setRevealed(secret.style.display !== "inline");
    });
    activeLifecycle.add(() => {
      delete element.dataset.quizifyInitialized;
    });
    registerRevealController({
      kind: "reveal",
      element,
      isRevealed: () => element.classList.contains("active"),
      reveal: () => setRevealed(true)
    });
  });
}
