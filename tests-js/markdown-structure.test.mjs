import assert from "node:assert/strict";
import test from "node:test";

import {
  fenceMarker,
  nextFence,
  uniqueSortedLetters
} from "../src/shared/markdown-structure.js";

test("shared Markdown structure helpers keep parser and diagnostics in sync", () => {
  const fence = fenceMarker("```javascript");
  assert.deepEqual(fence, { char: "`", length: 3 });
  assert.equal(nextFence("content", fence), fence);
  assert.equal(nextFence("````", fence), null);
  assert.equal(fenceMarker("    ```"), null);
  assert.equal(uniqueSortedLetters("cAba!"), "ABC");
});
