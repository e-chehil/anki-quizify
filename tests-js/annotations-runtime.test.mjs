import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  computeTooltipPlacement,
  initAnnotations
} from "../src/review/runtime/annotations.js";
import { createLifecycle } from "../src/review/lifecycle.js";

function rect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height
  };
}

test("tooltip placement stays inside offset boundaries and chooses the useful side", () => {
  const boundary = rect(300, 40, 280, 360);
  const nearLeft = computeTooltipPlacement(
    rect(302, 180, 20, 24),
    rect(0, 0, 240, 90),
    boundary
  );
  assert.equal(nearLeft.left, 310);
  assert(nearLeft.left + nearLeft.width <= boundary.right - 10);
  assert(nearLeft.arrowLeft >= 0 && nearLeft.arrowLeft <= nearLeft.width);

  const nearTop = computeTooltipPlacement(
    rect(430, 45, 30, 24),
    rect(0, 0, 220, 100),
    boundary
  );
  assert.equal(nearTop.placement, "bottom");
  assert(nearTop.top >= 50);

  const nearBottom = computeTooltipPlacement(
    rect(430, 370, 30, 24),
    rect(0, 0, 220, 100),
    boundary
  );
  assert.equal(nearBottom.placement, "top");
  assert(nearBottom.top >= 50);
  assert(nearBottom.top + nearBottom.height <= 390);
});

test("annotations keep one stable tooltip open and use the configured viewport", () => {
  const dom = new JSDOM(`<!doctype html><body>
    <span id="first" class="annotation" role="button" tabindex="0" aria-expanded="false">
      First<span class="tooltip" role="tooltip" aria-hidden="true">A long note</span>
    </span>
    <span id="second" class="annotation" role="button" tabindex="0" aria-expanded="false">
      Second<span class="tooltip" role="tooltip" aria-hidden="true">Another note</span>
    </span>
  </body>`, { pretendToBeVisual: true });
  const { document } = dom.window;
  const first = document.querySelector("#first");
  const second = document.querySelector("#second");
  const firstTooltip = first.querySelector(".tooltip");
  const secondTooltip = second.querySelector(".tooltip");
  first.getBoundingClientRect = () => rect(102, 40, 20, 24);
  second.getBoundingClientRect = () => rect(365, 300, 24, 24);
  firstTooltip.getBoundingClientRect = () => rect(0, 0, 260, 80);
  secondTooltip.getBoundingClientRect = () => rect(0, 0, 260, 80);
  dom.window.getQuizifyViewportRect = () => rect(100, 20, 300, 360);

  const lifecycle = createLifecycle();
  initAnnotations({
    root: dom.window,
    lifecycle,
    registerRevealController: () => {}
  });

  first.click();
  assert.equal(first.getAttribute("aria-expanded"), "true");
  assert.equal(firstTooltip.style.visibility, "visible");
  assert.equal(firstTooltip.style.left, "110px");
  assert.equal(firstTooltip.dataset.placement, "bottom");
  assert.equal(firstTooltip.style.display, "");

  second.click();
  assert.equal(first.getAttribute("aria-expanded"), "false");
  assert.equal(firstTooltip.style.visibility, "hidden");
  assert.equal(second.getAttribute("aria-expanded"), "true");
  assert.equal(secondTooltip.style.left, "130px");
  assert.equal(secondTooltip.dataset.placement, "top");

  document.body.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert.equal(second.getAttribute("aria-expanded"), "false");
  assert.equal(secondTooltip.style.visibility, "hidden");

  lifecycle.dispose();
  assert.equal(first.dataset.quizifyInitialized, undefined);
  assert.equal(second.dataset.quizifyInitialized, undefined);
});
