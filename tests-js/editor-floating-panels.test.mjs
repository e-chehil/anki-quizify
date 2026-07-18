import assert from "node:assert/strict";
import test from "node:test";

import { createFloatingPanelManager } from "../src/editor/floating-panels.js";

function element(rect = null) {
  return {
    attributes: {},
    children: [],
    className: "",
    hidden: false,
    listeners: {},
    style: {
      setProperty(name, value) {
        this[name] = value;
      }
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    },
    appendChild(child) {
      if (child.parentNode) {
        child.parentNode.children = child.parentNode.children.filter((item) => item !== child);
      }
      child.parentNode = this;
      this.children.push(child);
    },
    contains(target) {
      return target === this || this.children.some((child) => child.contains?.(target));
    },
    closest() {
      return null;
    },
    focus() {
      this.focused = true;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    getBoundingClientRect() {
      return rect;
    },
    querySelector(selector) {
      if (selector === "summary") return this.summary || null;
      return null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
}

function ownerWithSummary(rect) {
  const owner = element();
  owner.summary = element(rect);
  owner.summary.textContent = "面板";
  owner.appendChild(owner.summary);
  return owner;
}

test("floating panels stay inside small viewports and are mutually exclusive", () => {
  const body = element();
  const documentRef = {
    body,
    documentElement: { clientWidth: 280, clientHeight: 180 },
    listeners: {},
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    }
  };
  const root = {
    innerWidth: 280,
    innerHeight: 180,
    addEventListener() {},
    setTimeout(listener) {
      listener();
    }
  };
  const manager = createFloatingPanelManager(root, documentRef);

  const first = ownerWithSummary({ left: 240, right: 270, top: 70, bottom: 100 });
  const firstPanel = element();
  firstPanel.setAttribute("aria-label", "显式面板名称");
  first.appendChild(firstPanel);
  manager.bind(first, firstPanel, 860);

  assert.equal(first.summary.attributes["aria-haspopup"], "dialog");
  assert.equal(first.summary.attributes["aria-expanded"], "false");
  assert.equal(firstPanel.attributes["aria-label"], "显式面板名称");
  assert.equal(firstPanel.attributes.tabindex, "-1");
  const arrowDown = {
    key: "ArrowDown",
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
  first.summary.listeners.keydown(arrowDown);
  assert.equal(arrowDown.defaultPrevented, true);
  assert.equal(first.open, true, "ArrowDown should open the anchored panel");
  first.listeners.toggle();
  assert.equal(firstPanel.style.width, "264px");
  assert.equal(firstPanel.style.maxHeight, "65px");
  assert.equal(firstPanel.parentNode, body);
  assert.equal(firstPanel.focused, true, "a panel without controls should receive keyboard focus");

  const second = ownerWithSummary({ left: 10, right: 80, top: 20, bottom: 50 });
  const secondPanel = element();
  second.appendChild(secondPanel);
  manager.bind(second, secondPanel, 260);
  second.open = true;
  second.listeners.toggle();
  assert.equal(first.open, false);
  assert.equal(second.open, true);

  assert.equal(manager.closeTop(true), true);
  assert.equal(second.open, false);
  assert.equal(second.summary.focused, true);
  assert.equal(manager.closeTop(), false);
});
