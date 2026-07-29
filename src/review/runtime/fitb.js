import { resolveRuntimeLifecycle } from "../lifecycle.js";
import { iconSvg } from "../../shared/icons.js";

function normalizedAnswer(value) {
  const text = String(value ?? "").trim();
  return typeof text.normalize === "function" ? text.normalize("NFC") : text;
}

export function initFitb({
  root,
  userAnswers,
  saveUserAnswers,
  registerRevealController,
  lifecycle = null
}) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);

  const canvas = root.document.createElement("canvas");
  const context = canvas.getContext ? canvas.getContext("2d") : null;

  function fontFromElement(element) {
    const style = root.getComputedStyle ? root.getComputedStyle(element) : {};
    return [
      style.fontStyle,
      style.fontVariant,
      style.fontWeight,
      style.fontSize,
      style.fontFamily
    ].join(" ");
  }

  root.document.querySelectorAll(".fitb").forEach((fitb) => {
    if (fitb.dataset.quizifyInitialized === "true") return;

    const input = fitb.querySelector("input");
    const feedbackIcon = fitb.querySelector(".feedback-icon");
    if (!input || !feedbackIcon) return;
    fitb.dataset.quizifyInitialized = "true";

    const correctAnswer = (input.dataset.answer || "").trim();
    const normalizedCorrectAnswer = normalizedAnswer(correctAnswer);
    if (userAnswers.fitbs[input.name]) input.value = userAnswers.fitbs[input.name];

    function updateInputWidth() {
      if (!context) return;
      context.font = fontFromElement(input);
      const text = input.value || input.placeholder || "";
      const width = Math.max(Math.ceil(context.measureText(text).width + 52), 40);
      input.style.width = `${width}px`;
    }

    function grade() {
      if (!root.isBack) return;
      const userAnswer = input.value.trim();
      const correct = normalizedAnswer(userAnswer) === normalizedCorrectAnswer;
      fitb.classList.toggle("correct", correct);
      fitb.classList.toggle("error", !correct);
      feedbackIcon.innerHTML = iconSvg(correct ? "check" : "x", {
        className: "fitb-feedback-symbol"
      });
    }

    function revealCorrectAnswer() {
      input.value = correctAnswer;
      input.dispatchEvent(new root.Event("input", { bubbles: true }));
      fitb.classList.add("quizify-revealed", "correct");
      fitb.classList.remove("error");
      feedbackIcon.innerHTML = iconSvg("check", {
        className: "fitb-feedback-symbol"
      });
    }

    activeLifecycle.listen(input, "input", () => {
      updateInputWidth();
      userAnswers.fitbs[input.name] = input.value.trim();
      saveUserAnswers(userAnswers);
      grade();
    });
    activeLifecycle.listen(feedbackIcon, "click", revealCorrectAnswer);
    activeLifecycle.add(() => {
      delete fitb.dataset.quizifyInitialized;
    });

    updateInputWidth();
    grade();
    registerRevealController({
      kind: "fitb",
      element: fitb,
      isRevealed: () =>
        fitb.classList.contains("quizify-revealed") ||
        normalizedAnswer(input.value) === normalizedCorrectAnswer,
      reveal: revealCorrectAnswer
    });
  });
}
