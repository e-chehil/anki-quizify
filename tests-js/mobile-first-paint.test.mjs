import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const addon = new URL("../quizify_addon/", import.meta.url);
const bootstrap = await readFile(
  new URL("templates/first-paint.js", addon),
  "utf8"
);
const criticalCss = await readFile(
  new URL("templates/first-paint.css", addon),
  "utf8"
);
const reviewCss = await readFile(
  new URL("../src/review/styles.css", import.meta.url),
  "utf8"
);

function androidDocument({ bodyClass = "card", theme = "kaiwu" } = {}) {
  const config = JSON.stringify({ review: { theme } });
  return new JSDOM(
    `<!doctype html><html class="mobile android linux js"><head></head>` +
      `<body class="${bodyClass}">` +
      `<script type="application/json" id="quizify-config">${config}</script>` +
      `<script>${bootstrap}</script><style>${criticalCss}</style>` +
      `<div class="quizify-stage" data-quizify-first-paint="pending">Card</div>` +
      `</body></html>`,
    {
      runScripts: "dangerously",
      url: "https://quizify.local/"
    }
  );
}

const palettes = {
  kaiwu: {
    light: "rgb(242, 240, 233)",
    dark: "rgb(16, 22, 20)",
    token: "#101614"
  },
  gezhi: {
    light: "rgb(228, 223, 215)",
    dark: "rgb(34, 32, 46)",
    token: "#22202e"
  }
};

for (const theme of Object.keys(palettes)) {
  test(`${theme} paints the light canvas before the review runtime loads`, () => {
    const dom = androidDocument({ theme });
    const { document } = dom.window;
    assert.equal(document.documentElement.dataset.quizifyNight, "false");
    assert.equal(document.documentElement.dataset.quizifyTheme, theme);
    assert.equal(
      dom.window.getComputedStyle(document.documentElement).backgroundColor,
      palettes[theme].light
    );
    dom.window.__quizifyFirstPaint.cancel();
    dom.window.close();
  });

  for (const nightClass of [
    "nightMode",
    "night-mode",
    "night_mode",
    "ankidroid_dark_mode"
  ]) {
    test(`${theme} keeps ${nightClass} dark on front, back, and next-card documents`, () => {
      for (const side of ["front", "back", "next-front"]) {
        const dom = androidDocument({
          bodyClass: `card ${nightClass} ${side}`,
          theme
        });
        const { document } = dom.window;
        assert.equal(document.documentElement.dataset.quizifyNight, "true");
        assert.equal(document.body.dataset.quizifyNight, "true");
        assert.equal(document.documentElement.dataset.quizifyTheme, theme);
        assert.equal(document.body.dataset.quizifyTheme, theme);
        assert.equal(
          dom.window.getComputedStyle(document.documentElement).backgroundColor,
          palettes[theme].dark
        );

        const fullStyle = document.createElement("style");
        fullStyle.textContent = reviewCss;
        document.head.appendChild(fullStyle);
        assert.equal(
          dom.window
            .getComputedStyle(document.documentElement)
            .getPropertyValue("--q-bg")
            .trim(),
          palettes[theme].token
        );
        assert.match(reviewCss, /body\s*\{[\s\S]*?background-color:\s*var\(--q-bg\)/);
        assert.match(
          reviewCss,
          /body\.card,\s*\.card\s*\{[\s\S]*?background-color:\s*var\(--q-bg\)/
        );
        dom.window.__quizifyFirstPaint.cancel();
        dom.window.close();
      }
    });
  }
}

test("the readiness gate reveals only after boot or its fail-open callback", () => {
  const dom = androidDocument({ bodyClass: "card night_mode" });
  const { document } = dom.window;
  const stage = document.querySelector(".quizify-stage");
  assert.equal(dom.window.getComputedStyle(stage).visibility, "hidden");

  dom.window.__quizifyFirstPaint.reveal();

  assert.equal(stage.hasAttribute("data-quizify-first-paint"), false);
  assert.equal(dom.window.getComputedStyle(stage).visibility, "visible");
  dom.window.close();
});
