import { getLocale, setLocale } from "../shared/i18n.js";

function scriptUrl(script) {
  try {
    return script?.src ? new URL(script.src, document.baseURI) : null;
  } catch {
    return null;
  }
}

function isEditorBundle(url) {
  return Boolean(url && /\/web\/editor\.js$/.test(url.pathname));
}

function locateEditorBundle() {
  const current = scriptUrl(document.currentScript);
  if (isEditorBundle(current)) return current;

  const candidates = Array.from(document.scripts || [])
    .map(scriptUrl)
    .filter(isEditorBundle);
  const marked = candidates.find((url) => url.searchParams.get("quizify") === "1");
  if (marked) return marked;
  return candidates.length === 1 ? candidates[0] : null;
}

export const editorBundleUrl = locateEditorBundle();
export const quizifyEditorLocale = setLocale(
  editorBundleUrl?.searchParams.get("lang") || getLocale()
);
export const quizifyNotetypeId = editorBundleUrl?.searchParams.get("ntid") || "";
export function normalizeReviewTheme(value) {
  return value === "gezhi" || value === "kaiwu" ? value : "kaiwu";
}
export const quizifyReviewTheme = normalizeReviewTheme(
  editorBundleUrl?.searchParams.get("theme")
);
export const quizifyPlainTextIndices = new Set(
  (editorBundleUrl?.searchParams.get("plain") || "")
    .split(",")
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isInteger)
);
