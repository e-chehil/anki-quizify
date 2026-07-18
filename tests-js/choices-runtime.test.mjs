import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { createLifecycle } from "../src/review/lifecycle.js";
import { initChoices } from "../src/review/runtime/choices.js";

function choiceDom() {
  return new JSDOM(
    '<!doctype html><body><div class="choice" data-correct="A">' +
      '<div class="options">' +
      '<label class="option"><input type="radio" name="question" value="B"><span class="checkmark"></span>Bee</label>' +
      '<label class="option"><input type="radio" name="question" value="A"><span class="checkmark"></span>Ay</label>' +
      "</div>" +
      '<button class="feedback" data-is-answered="false"></button>' +
      "</div></body>",
    { url: "https://anki.local/" }
  );
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
  dom.window.close();
});
