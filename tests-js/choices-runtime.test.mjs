import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/review/lifecycle.js";
import { initChoices } from "../src/review/runtime/choices.js";

function choiceDom() {
  return new JSDOM(
    '<!doctype html><body><div class="choice" data-correct="A">' +
      '<div class="options">' +
      '<label class="option"><input type="radio" name="question" value="B"><span class="checkmark"></span><span class="option-seq">B</span>Bee</label>' +
      '<label class="option"><input type="radio" name="question" value="A"><span class="checkmark"></span>Ay</label>' +
      "</div>" +
      '<button class="feedback" data-is-answered="false"></button>' +
      "</div></body>",
    { url: "https://anki.local/" }
  );
}

const OPTION_RESULT_CLASSES = ["correct", "incorrect", "not-selected"];
const FEEDBACK_RESULT_CLASSES = ["correct", "incorrect", "incomplete"];

function reviewChoice({ correct, selected, type }) {
  const optionMarkup = ["A", "B", "C", "D"]
    .map(
      (value) =>
        `<label class="option"><input type="${type}" name="question" value="${value}">` +
        `<span class="checkmark"></span>${value}</label>`
    )
    .join("");
  const dom = new JSDOM(
    '<!doctype html><body>' +
      `<div class="choice" data-correct="${correct}">` +
      `<div class="options">${optionMarkup}</div>` +
      '<button class="feedback" data-is-answered="false"></button>' +
      "</div></body>",
    { url: "https://anki.local/" }
  );
  dom.window.isBack = true;
  initChoices({
    root: dom.window,
    lifecycle: createLifecycle(),
    userAnswers: { fitbs: {}, mcqs: { question: selected } },
    saveUserAnswers() {},
    registerRevealController() {}
  });

  const optionStates = Object.fromEntries(
    Array.from(dom.window.document.querySelectorAll("label.option"), (label) => {
      const value = label.querySelector("input").value;
      return [
        value,
        OPTION_RESULT_CLASSES.filter((className) => label.classList.contains(className))
      ];
    })
  );
  const feedback = dom.window.document.querySelector(".feedback");
  const feedbackStates = FEEDBACK_RESULT_CLASSES.filter((className) =>
    feedback.classList.contains(className)
  );
  dom.window.close();
  return { optionStates, feedbackStates };
}

test("choice review labels retain their declared option letters", () => {
  const dom = choiceDom();
  dom.window.isBack = true;
  initChoices({
    root: dom.window,
    lifecycle: createLifecycle(),
    userAnswers: { fitbs: {}, mcqs: {} },
    saveUserAnswers() {},
    registerRevealController() {}
  });

  const labels = Array.from(dom.window.document.querySelectorAll("label.option"));
  assert.deepEqual(
    labels.map((label) => [
      label.querySelector("input").value,
      label.querySelector(".option-seq").textContent
    ]),
    [["A", "A"], ["B", "B"]]
  );
  assert.ok(
    labels.every(
      (label) => label.querySelector(".option-seq").style.display === ""
    ),
    "review mode should let the .option-seq CSS rule control its display"
  );
  dom.window.close();
});

test("retrying a choice clears both the UI and its persisted answer", () => {
  const dom = choiceDom();
  dom.window.isBack = false;
  const userAnswers = { fitbs: {}, mcqs: {} };
  const saved = [];
  initChoices({
    root: dom.window,
    lifecycle: createLifecycle(),
    userAnswers,
    saveUserAnswers(value) {
      saved.push(structuredClone(value));
    },
    registerRevealController() {}
  });

  assert.ok(
    Array.from(dom.window.document.querySelectorAll(".option-seq")).every(
      (sequence) => sequence.style.display === "none"
    ),
    "answer mode should initially show only the checkmark slot"
  );

  const answer = dom.window.document.querySelector('input[value="A"]');
  const feedback = dom.window.document.querySelector(".feedback");
  answer.checked = true;
  answer.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  feedback.click();
  feedback.click();

  assert.equal(answer.checked, false);
  assert.deepEqual(userAnswers.mcqs.question, []);
  assert.deepEqual(saved.at(-1).mcqs.question, []);
  assert.equal(
    dom.window.document.querySelectorAll("label.option.selected").length,
    0
  );
  assert.ok(
    Array.from(dom.window.document.querySelectorAll(".checkmark")).every(
      (checkmark) => checkmark.style.display === ""
    ),
    "answer mode should let the .checkmark CSS rule control its display"
  );
  assert.ok(
    Array.from(dom.window.document.querySelectorAll(".option-seq")).every(
      (sequence) => sequence.style.display === "none"
    ),
    "answer mode should hide every sequence marker after retrying"
  );
  dom.window.close();
});

test("single-choice review applies the complete option and feedback state matrix", () => {
  const cases = [
    {
      name: "correct answer",
      selected: ["A"],
      optionStates: { A: ["correct"], B: [], C: [], D: [] },
      feedbackStates: ["correct"]
    },
    {
      name: "wrong answer",
      selected: ["B"],
      optionStates: { A: ["not-selected"], B: ["incorrect"], C: [], D: [] },
      feedbackStates: ["incorrect"]
    },
    {
      name: "unanswered",
      selected: [],
      optionStates: { A: ["not-selected"], B: [], C: [], D: [] },
      feedbackStates: ["incorrect"]
    }
  ];

  for (const fixture of cases) {
    const result = reviewChoice({
      correct: "A",
      selected: fixture.selected,
      type: "radio"
    });
    assert.deepEqual(result.optionStates, fixture.optionStates, fixture.name);
    assert.deepEqual(result.feedbackStates, fixture.feedbackStates, fixture.name);
  }
});

test("multiple-choice review distinguishes exact, partial, and wrong answers", () => {
  const cases = [
    {
      name: "exact answer",
      selected: ["A", "C"],
      optionStates: { A: ["correct"], B: [], C: ["correct"], D: [] },
      feedbackStates: ["correct"]
    },
    {
      name: "correct but incomplete answer",
      selected: ["A"],
      optionStates: { A: ["correct"], B: [], C: ["not-selected"], D: [] },
      feedbackStates: ["incomplete"]
    },
    {
      name: "wrong-only answer",
      selected: ["B"],
      optionStates: {
        A: ["not-selected"],
        B: ["incorrect"],
        C: ["not-selected"],
        D: []
      },
      feedbackStates: ["incorrect"]
    },
    {
      name: "mixed correct and wrong answer",
      selected: ["A", "B"],
      optionStates: {
        A: ["correct"],
        B: ["incorrect"],
        C: ["not-selected"],
        D: []
      },
      feedbackStates: ["incorrect"]
    },
    {
      name: "unanswered",
      selected: [],
      optionStates: {
        A: ["not-selected"],
        B: [],
        C: ["not-selected"],
        D: []
      },
      feedbackStates: ["incorrect"]
    }
  ];

  for (const fixture of cases) {
    const result = reviewChoice({
      correct: "AC",
      selected: fixture.selected,
      type: "checkbox"
    });
    assert.deepEqual(result.optionStates, fixture.optionStates, fixture.name);
    assert.deepEqual(result.feedbackStates, fixture.feedbackStates, fixture.name);
  }
});
