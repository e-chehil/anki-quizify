(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var body = doc.body;
  var config = {};
  var configNode = doc.getElementById("quizify-config");
  var nightClasses = [
    "nightMode",
    "night-mode",
    "night_mode",
    "ankidroid_dark_mode"
  ];

  try {
    config = JSON.parse((configNode && configNode.textContent) || "{}");
  } catch (_error) {
    config = {};
  }

  var theme =
    config.review && config.review.theme === "gezhi" ? "gezhi" : "kaiwu";
  var night = nightClasses.some(function (className) {
    return Boolean(
      (root && root.classList.contains(className)) ||
        (body && body.classList.contains(className))
    );
  });

  root.setAttribute("data-quizify-active", "true");
  root.setAttribute("data-quizify-theme", theme);
  root.setAttribute("data-quizify-night", night ? "true" : "false");
  if (body) {
    body.setAttribute("data-quizify-theme", theme);
    body.setAttribute("data-quizify-night", night ? "true" : "false");
  }

  var previous = globalThis.__quizifyFirstPaint;
  if (previous && typeof previous.cancel === "function") {
    previous.cancel();
  }

  var timer = 0;
  function reveal() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    doc
      .querySelectorAll('[data-quizify-first-paint="pending"]')
      .forEach(function (stage) {
        stage.removeAttribute("data-quizify-first-paint");
      });
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
  }

  timer = setTimeout(reveal, 2500);
  globalThis.__quizifyFirstPaint = {
    cancel: cancel,
    night: night,
    reveal: reveal,
    theme: theme
  };
})();
