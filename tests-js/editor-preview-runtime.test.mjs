import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("editor preview initializes disposable card interactions", async () => {
  const dom = new JSDOM(`<!doctype html><body><section id="preview" class="quizify-field">
    <div class="tabs-container">
      <div class="tabs-nav">
        <div class="tab-button active" role="tab" tabindex="0" aria-selected="true">一</div>
        <div class="tab-button" role="tab" tabindex="-1" aria-selected="false">二</div>
      </div>
      <div class="tabs-content">
        <div class="tab-pane active" aria-hidden="false">内容一</div>
        <div class="tab-pane" aria-hidden="true">内容二</div>
      </div>
    </div>
    <span class="reveal">答案：<span class="secret">42</span></span>
    <div class="choice" data-correct="A">
      <div class="options">
        <label class="option"><input type="radio" name="choice-1" value="A"><span class="checkmark"></span>甲</label>
        <label class="option"><input type="radio" name="choice-1" value="B"><span class="checkmark"></span>乙</label>
      </div>
      <button class="feedback" type="button">显示答案</button>
    </div>
  </section></body>`, { pretendToBeVisual: true });

  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({
    font: "",
    measureText: (value) => ({ width: String(value).length * 8 })
  });
  const { disposePreviewInteractions, initPreviewInteractions } = await import(
    `../src/editor/preview-runtime.js?preview-test=${Date.now()}`
  );
  const preview = document.querySelector("#preview");
  initPreviewInteractions(preview);

  const tabs = [...preview.querySelectorAll(".tab-button")];
  tabs[1].click();
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(preview.querySelectorAll(".tab-pane")[1].getAttribute("aria-hidden"), "false");

  const reveal = preview.querySelector(".reveal");
  assert.equal(reveal.querySelector(".secret").style.display, "none");
  reveal.click();
  assert.equal(reveal.querySelector(".secret").style.display, "inline");

  const answer = preview.querySelector('input[value="A"]');
  answer.checked = true;
  answer.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  preview.querySelector(".feedback").click();
  assert.match(preview.querySelector(".feedback").textContent, /回答正确/);

  disposePreviewInteractions(preview);
  initPreviewInteractions(preview);
  assert.equal(reveal.querySelector(".secret").style.display, "none");
  reveal.click();
  assert.equal(
    reveal.querySelector(".secret").style.display,
    "inline",
    "reinitialization must attach exactly one reveal listener"
  );

  disposePreviewInteractions(preview);
  reveal.click();
  assert.equal(
    reveal.querySelector(".secret").style.display,
    "inline",
    "disposing a preview must remove every runtime listener"
  );
});

test("editor preview constrains annotation tooltips to the preview host", async () => {
  const dom = new JSDOM(`<!doctype html><body><section id="preview" class="quizify-field">
    <span class="annotation" role="button" tabindex="0" aria-expanded="false">
      term<span class="tooltip" role="tooltip" aria-hidden="true">A long annotation</span>
    </span>
  </section></body>`, { pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  const { disposePreviewInteractions, initPreviewInteractions } = await import(
    `../src/editor/preview-runtime.js?preview-tooltip-test=${Date.now()}`
  );
  const preview = document.querySelector("#preview");
  const annotation = preview.querySelector(".annotation");
  const tooltip = preview.querySelector(".tooltip");
  preview.getBoundingClientRect = () => ({
    left: 400,
    top: 100,
    right: 680,
    bottom: 500,
    width: 280,
    height: 400
  });
  annotation.getBoundingClientRect = () => ({
    left: 650,
    top: 220,
    right: 674,
    bottom: 244,
    width: 24,
    height: 24
  });
  tooltip.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 220,
    bottom: 80,
    width: 220,
    height: 80
  });

  initPreviewInteractions(preview);
  annotation.click();
  assert.equal(tooltip.style.left, "450px");
  assert(Number.parseFloat(tooltip.style.left) >= 410);
  assert(Number.parseFloat(tooltip.style.left) + 220 <= 670);

  disposePreviewInteractions(preview);
});
