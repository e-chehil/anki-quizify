import { resolveRuntimeLifecycle } from "../lifecycle.js";

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
      fitb.classList.toggle("correct", userAnswer === correctAnswer);
      fitb.classList.toggle("error", userAnswer !== correctAnswer);
      feedbackIcon.textContent = userAnswer === correctAnswer ? "✓" : "✕";
    }

    function revealCorrectAnswer() {
      input.value = correctAnswer;
      input.dispatchEvent(new root.Event("input", { bubbles: true }));
      fitb.classList.add("quizify-revealed", "correct");
      fitb.classList.remove("error");
      feedbackIcon.textContent = "✓";
    }

    activeLifecycle.listen(input, "input", () => {
      updateInputWidth();
      userAnswers.fitbs[input.name] = input.value.trim();
      saveUserAnswers(userAnswers);
      grade();
    });
    activeLifecycle.listen(feedbackIcon, "click", revealCorrectAnswer);
    activeLifecycle.listen(feedbackIcon, "keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      feedbackIcon.click();
    });
    activeLifecycle.add(() => {
      delete fitb.dataset.quizifyInitialized;
    });

    updateInputWidth();
    grade();
    registerRevealController({
      kind: "fitb",
      element: fitb,
      isRevealed: () =>
        fitb.classList.contains("quizify-revealed") || input.value.trim() === correctAnswer,
      reveal: revealCorrectAnswer
    });
  });
}
