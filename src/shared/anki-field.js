export function decodeAnkiFieldHtml(html, documentRef = globalThis.document) {
  const text = String(html ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n");
  const decoder = documentRef?.createElement?.("textarea") || null;

  const fallback = () =>
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&amp;/g, "&");

  if (!decoder) return fallback();

  decoder.innerHTML = text;
  return typeof decoder.value === "string" ? decoder.value : fallback();
}

const QUIZIFY_SOURCE_MARKER =
  /<!--\s*quizify-source:(?:start|safe|end):[a-z0-9_-]+\s*-->/gi;
const QUIZIFY_SAFE_SOURCE_MARKER =
  /<!--\s*quizify-source:safe:[a-z0-9_-]+\s*-->/i;

export function readAnkiFieldSource(field, documentRef = globalThis.document) {
  if (!field) return "";
  const html = String(field.innerHTML ?? "");
  if (QUIZIFY_SAFE_SOURCE_MARKER.test(html)) {
    return String(field.textContent ?? "");
  }
  return decodeAnkiFieldHtml(html.replace(QUIZIFY_SOURCE_MARKER, ""), documentRef);
}
