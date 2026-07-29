import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  brandMarkSvg,
  createBrandMarkElement,
  createIconElement,
  iconSvg
} from "../src/shared/icons.js";

const requiredIcons = [
  "bold",
  "italic",
  "strikethrough",
  "code-inline",
  "code-block",
  "link",
  "heading-1",
  "quote",
  "highlight",
  "superscript",
  "subscript",
  "alert",
  "list",
  "list-ordered",
  "image",
  "table",
  "fitb",
  "choice",
  "reveal",
  "reveal-card",
  "annotation",
  "collapse",
  "tabs",
  "audio",
  "recite",
  "preview",
  "status-ok",
  "status-warning",
  "status-error",
  "replay",
  "play",
  "pause",
  "cancel",
  "shuffle",
  "info",
  "tip",
  "important",
  "caution",
  "flip",
  "move",
  "loading",
  "focus"
];

const integrationAliases = [
  "inline-code",
  "github-alert",
  "blockquote",
  "unordered-list",
  "ordered-list",
  "rotate-ccw",
  "x",
  "lightbulb",
  "circle-alert",
  "triangle-alert",
  "check",
  "eye",
  "eye-off",
  "flip-horizontal-2",
  "loader",
  "chevron-down",
  "check-square",
  "panels-top-left",
  "braces",
  "circle-dot",
  "code"
];

test("every shared catalog entry serializes as inert SVG", () => {
  for (const name of [...requiredIcons, ...integrationAliases]) {
    const markup = iconSvg(name, { className: "quizify-icon icon-state" });
    assert.match(markup, /^<svg /, name);
    assert.match(markup, /width="24" height="24" viewBox="0 0 24 24"/, name);
    assert.match(markup, /fill="none" stroke="currentColor" stroke-width="2"/, name);
    assert.match(markup, /stroke-linecap="round" stroke-linejoin="round"/, name);
    assert.match(markup, /aria-hidden="true" focusable="false"/, name);
    assert.match(markup, /class="quizify-icon icon-state"/, name);
    assert.doesNotMatch(markup, /<text\b|font-family|on\w+=/i, name);
  }
});

test("icon names and CSS class tokens are closed over trusted values", () => {
  assert.throws(() => iconSvg("not-in-the-catalog"), RangeError);
  assert.throws(() => iconSvg(null), RangeError);
  assert.throws(
    () => iconSvg("eye", { className: 'safe" onload="alert(1)' }),
    TypeError
  );
});

test("DOM helpers create namespaced, text-free SVG elements", () => {
  const dom = new JSDOM("<!doctype html><body></body>");
  const icon = createIconElement(dom.window.document, "play", {
    className: "quizify-icon"
  });

  assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(icon.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(icon.getAttribute("stroke"), "currentColor");
  assert.equal(icon.getAttribute("aria-hidden"), "true");
  assert.equal(icon.getAttribute("focusable"), "false");
  assert.equal(icon.classList.contains("quizify-icon"), true);
  assert.equal(icon.textContent, "");
  assert(icon.querySelector("path"));
  dom.window.close();
});

test("DOM helpers retain the legacy createElement-only adapter fallback", () => {
  function createElement(tagName) {
    return {
      tagName,
      children: [],
      className: "",
      setAttribute(name, value) {
        this[name] = String(value);
      },
      appendChild(child) {
        this.children.push(child);
      }
    };
  }
  const icon = createIconElement({ createElement }, "preview", {
    className: "quizify-icon"
  });

  assert.equal(icon.tagName, "svg");
  assert.equal(icon.className, "quizify-icon");
  assert.equal(icon.viewBox, "0 0 24 24");
  assert(icon.children.length > 0);
});

test("the original Quizify Q is vector geometry rather than a font glyph", () => {
  const markup = brandMarkSvg({ className: "quizify-brand-mark" });
  assert.match(markup, /^<svg /);
  assert.match(markup, /<circle /);
  assert.equal((markup.match(/<path /g) || []).length, 2);
  assert.doesNotMatch(markup, /<text\b|>\s*Q\s*</i);

  const dom = new JSDOM("<!doctype html><body></body>");
  const mark = createBrandMarkElement(dom.window.document, {
    className: "quizify-brand-mark"
  });
  assert.equal(mark.textContent, "");
  assert.equal(mark.querySelectorAll("circle").length, 1);
  assert.equal(mark.querySelectorAll("path").length, 2);
  dom.window.close();
});
