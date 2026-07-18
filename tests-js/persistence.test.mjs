import assert from "node:assert/strict";
import test from "node:test";

import { createReviewStorage } from "../src/review/runtime/persistence.js";

function target() {
  const values = new Map();
  return {
    Persistence: {
      isAvailable: () => true,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    }
  };
}

test("review storage isolates answer, reveal, recite and position state", () => {
  const host = target();
  const storage = createReviewStorage(host);

  storage.saveUserAnswers({ fitbs: { a: "42" }, mcqs: {} });
  storage.saveRevealProgress({ revealed: ["front-reveal-0"], completed: false });
  storage.saveReciteState({ front: { masked: [1] } });
  storage.saveFloatingPosition({ x: 0.25, y: 0.75 });

  assert.deepEqual(storage.loadUserAnswers(), { fitbs: { a: "42" }, mcqs: {} });
  assert.deepEqual(storage.loadRevealProgress().revealed, ["front-reveal-0"]);
  assert.deepEqual(storage.loadReciteState(), { front: { masked: [1] } });
  assert.deepEqual(storage.loadFloatingPosition(), { x: 0.25, y: 0.75 });

  storage.clearUserAnswers();
  storage.clearRevealProgress();
  storage.clearReciteState();
  assert.deepEqual(storage.loadUserAnswers(), { fitbs: {}, mcqs: {} });
  assert.deepEqual(storage.loadRevealProgress(), { revealed: [], completed: false });
  assert.deepEqual(storage.loadReciteState(), {});
});

test("review storage degrades safely when persistence is unavailable", () => {
  const storage = createReviewStorage({ Persistence: { isAvailable: () => false } });
  assert.deepEqual(storage.loadUserAnswers(), { fitbs: {}, mcqs: {} });
  assert.deepEqual(storage.loadRevealProgress(), { revealed: [], completed: false });
  assert.deepEqual(storage.loadReciteState(), {});
  assert.equal(storage.loadFloatingPosition(), null);
});
