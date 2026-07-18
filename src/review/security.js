import DOMPurify from "dompurify";

export const MAX_FIELD_BYTES = 512 * 1024;

const SANITIZE_OPTIONS = Object.freeze({
  // Quizify's own controls use a very small inline-SVG icon set. The SVG
  // profile keeps those shapes while DOMPurify still strips scripts, event
  // handlers and unsafe links from user-authored SVG.
  USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: true },
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "base"],
  FORBID_ATTR: ["style", "srcdoc", "formaction"],
  ADD_TAGS: ["audio", "video", "source"],
  ADD_ATTR: [
    "controls",
    "controlslist",
    "loop",
    "muted",
    "playsinline",
    "preload",
    "poster"
  ]
});

export function utf8Size(value) {
  const text = String(value ?? "");
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(text).byteLength
    : text.length * 2;
}

export function sanitizeRenderedHtml(value) {
  const text = String(value ?? "");
  // DOMPurify binds to the browser window. Pure Node contract tests have no
  // DOM, so they exercise parser output without pretending to sanitize it.
  return typeof DOMPurify.sanitize === "function"
    ? DOMPurify.sanitize(text, SANITIZE_OPTIONS)
    : text;
}
