const assert = require("node:assert/strict");

const containers = [
  {
    attributes: new Map(),
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
    classList: {
      values: new Set(),
      toggle(name, enabled) {
        if (enabled) this.values.add(name);
        else this.values.delete(name);
      },
      contains(name) {
        return this.values.has(name);
      }
    }
  }
];

global.document = {
  getElementById(id) {
    if (id !== "quizify-config") return null;
    return {
      textContent: JSON.stringify({ cardless: true })
    };
  },
  querySelectorAll(selector) {
    return selector === ".container" ? containers : [];
  }
};

const quizify = require("../quizify_addon/_quizify.js");

const config = quizify._internal.readConfig();
assert.equal(config.cardless, true);

quizify._internal.applyConfig(config);
assert.equal(containers[0].classList.contains("quizify-cardless"), true);
assert.equal(containers[0].attributes.get("data-quizify-theme"), "kaiwu");

quizify._internal.applyConfig({ cardless: false, review: { theme: "gezhi" } });
assert.equal(containers[0].classList.contains("quizify-cardless"), false);
assert.equal(containers[0].attributes.get("data-quizify-theme"), "gezhi");

console.log("quizify config tests passed");
