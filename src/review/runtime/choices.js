import { resolveRuntimeLifecycle } from "../lifecycle.js";

function updateSelectedClasses(inputs, labels) {
  labels.forEach((label) => label.classList.remove("selected"));
  inputs.forEach((input) => {
    const label = input.closest("label.option");
    if (input.checked && label) label.classList.add("selected");
  });
}

export function initChoices({
  root,
  userAnswers,
  saveUserAnswers,
  registerRevealController,
  lifecycle = null
}) {
  if (!root.document) return;
  const activeLifecycle = resolveRuntimeLifecycle(root, lifecycle);

  root.document.querySelectorAll(".choice").forEach((choice) => {
    if (choice.dataset.quizifyInitialized === "true") return;

    const correct = (choice.dataset.correct || "").split("").sort();
    const options = choice.querySelector(".options");
    const feedback = choice.querySelector(".feedback");
    if (!options || !feedback) return;

    const labels = Array.from(options.querySelectorAll("label.option"));
    const inputs = Array.from(options.querySelectorAll("input"));
    if (!inputs.length) return;
    choice.dataset.quizifyInitialized = "true";
    const name = inputs[0].name;

    labels.forEach((label, index) => {
      let sequence = label.querySelector(".option-seq");
      if (!sequence) {
        const input = label.querySelector("input");
        sequence = root.document.createElement("span");
        sequence.className = "option-seq";
        sequence.textContent = input?.value || String.fromCharCode(65 + index);
        label.insertBefore(sequence, label.firstChild);
      }
      sequence.style.display = "none";
    });

    function shuffleOptions() {
      const shuffled = Array.from(options.querySelectorAll("label.option"));
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
      }
      shuffled.forEach((label) => options.appendChild(label));
    }

    function restoreOptions() {
      Array.from(options.querySelectorAll("label.option"))
        .map((label) => ({ label, value: label.querySelector("input")?.value || "" }))
        .sort((left, right) => left.value.localeCompare(right.value))
        .forEach((item) => options.appendChild(item.label));
    }

    function selectedAnswers() {
      return inputs
        .filter((input) => input.checked)
        .map((input) => input.value)
        .sort();
    }

    function enterAnswerMode(shouldShuffle) {
      labels.forEach((label) => {
        const input = label.querySelector("input");
        const sequence = label.querySelector(".option-seq");
        const checkmark = label.querySelector(".checkmark");
        label.classList.remove("correct", "incorrect", "not-selected");
        if (input) {
          input.disabled = false;
          input.checked = false;
          input.style.display = "inline-block";
        }
        if (sequence) sequence.style.display = "none";
        if (checkmark) checkmark.style.removeProperty("display");
      });
      updateSelectedClasses(inputs, labels);
      userAnswers.mcqs[name] = [];
      saveUserAnswers(userAnswers);
      if (shouldShuffle) shuffleOptions();
      feedback.textContent = `${correct.length === 1 ? "单选题" : "多选题"} | 点击显示答案`;
      feedback.classList.remove("correct", "incorrect", "incomplete");
      feedback.dataset.isAnswered = "false";
    }

    function enterReviewMode() {
      restoreOptions();
      labels.forEach((label) => {
        const input = label.querySelector("input");
        const sequence = label.querySelector(".option-seq");
        const checkmark = label.querySelector(".checkmark");
        if (input) {
          input.disabled = true;
          input.style.display = "none";
        }
        if (sequence) sequence.style.removeProperty("display");
        if (checkmark) checkmark.style.display = "none";
      });

      const selected = selectedAnswers();
      feedback.classList.remove("correct", "incorrect", "incomplete");
      if (!selected.length) {
        feedback.textContent = "你没有回答";
        feedback.classList.add("incorrect");
      } else if (JSON.stringify(selected) === JSON.stringify(correct)) {
        feedback.textContent = "回答正确";
        feedback.classList.add("correct");
      } else {
        feedback.textContent = `你的答案：${selected.join("")}`;
        feedback.classList.add(
          selected.every((value) => correct.includes(value)) ? "incomplete" : "incorrect"
        );
      }
      feedback.textContent += ` | 正确答案：${correct.join("")}`;

      labels.forEach((label) => {
        const input = label.querySelector("input");
        if (!input) return;
        label.classList.toggle("correct", input.checked && correct.includes(input.value));
        label.classList.toggle("incorrect", input.checked && !correct.includes(input.value));
        label.classList.toggle("not-selected", !input.checked && correct.includes(input.value));
      });
      feedback.dataset.isAnswered = "true";
    }

    const restored = userAnswers.mcqs[name];
    if (restored) {
      inputs.forEach((input) => {
        input.checked = restored.includes(input.value);
      });
    }
    updateSelectedClasses(inputs, labels);
    shuffleOptions();
    if (root.isBack) enterReviewMode();

    activeLifecycle.listen(feedback, "click", () => {
      if (feedback.dataset.isAnswered === "true") enterAnswerMode(true);
      else enterReviewMode();
    });
    inputs.forEach((input) => {
      activeLifecycle.listen(input, "change", () => {
        updateSelectedClasses(inputs, labels);
        userAnswers.mcqs[name] = selectedAnswers();
        saveUserAnswers(userAnswers);
      });
    });
    activeLifecycle.add(() => {
      delete choice.dataset.quizifyInitialized;
    });
    registerRevealController({
      kind: choice.dataset.quizifyKind || "choice",
      element: choice,
      isRevealed: () => feedback.dataset.isAnswered === "true",
      reveal: enterReviewMode
    });
  });
}
