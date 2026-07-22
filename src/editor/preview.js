import { katex } from "../review/dependencies.js";
import { highlightCodeElement } from "../review/code.js";
import { MAX_FIELD_BYTES, utf8Size } from "../review/security.js";
import { enhanceOutlineLists } from "../review/outline.js";
import { enhanceMarkdownTables } from "../review/tables.js";
import { renderMathPlaceholders } from "../shared/math.js";
import {
  disposePreviewInteractions,
  initPreviewInteractions
} from "./preview-runtime.js";

const PREVIEW_DEBOUNCE_MS = 250;
const BUNDLED_REVIEW_CSS =
  typeof __QUIZIFY_REVIEW_CSS__ === "string" ? __QUIZIFY_REVIEW_CSS__ : "";
let timer = null;
let lastRenderKey = null;
let lastRenderTarget = null;

function addonRootUrl() {
  const script = Array.from(document.scripts).find((item) =>
    /\/web\/editor\.js(?:\?|$)/.test(item.src)
  );
  return script ? new URL("../", script.src).href : "";
}

function embeddedReviewStyle() {
  const style = document.createElement("style");
  const rootUrl = addonRootUrl();
  style.textContent = rootUrl
    ? BUNDLED_REVIEW_CSS.replace(
        /url\((['"]?)\.\/([^)'"\s]+)\1\)/g,
        (_match, _quote, asset) => `url("${new URL(asset, rootUrl).href}")`
      )
    : BUNDLED_REVIEW_CSS;
  return style;
}

function darkThemeActive() {
  return [document.documentElement, document.body].some(
    (element) =>
      element?.classList?.contains("nightMode") ||
      element?.classList?.contains("night-mode")
  );
}

function syncPreviewTheme(host) {
  const dark = darkThemeActive();
  host?.classList?.toggle("nightMode", dark);
  host?.setAttribute("data-theme", dark ? "dark" : "light");
  return dark;
}

function previewShellStyle() {
  const style = document.createElement("style");
  style.textContent = `
    :host {
      display: block;
      min-height: 150px;
      color: var(--q-text);
      color-scheme: light;
      font-family: var(--q-font);
      font-size: 14px;
      line-height: 1.72;
    }
    :host(.nightMode) { color-scheme: dark; }
    .quizify-preview-surface.container.quizify-cardless {
      width: 100%;
      min-height: 150px;
      margin: 0;
      padding: 20px clamp(16px, 3vw, 30px) 24px;
      background: var(--q-surface);
      border: 0;
      border-radius: 0;
      box-shadow: none;
      color: var(--q-text);
    }
  `;
  return style;
}

function ensurePreview() {
  const panel = document.querySelector(".quizify-live-preview-panel");
  if (!panel || panel.querySelector(".quizify-rendered-preview")) return;

  const preview = document.createElement("section");
  preview.className = "quizify-rendered-preview";

  const header = document.createElement("header");
  header.className = "quizify-rendered-preview-header";
  const heading = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "交互渲染预览";
  const hint = document.createElement("span");
  hint.textContent = "可试用题型、折叠、标签页、背诵和音频；预览操作不会保存答案";
  heading.append(title, hint);
  const fieldName = document.createElement("span");
  fieldName.className = "quizify-rendered-preview-field";
  fieldName.textContent = "未选择字段";
  header.append(heading, fieldName);
  preview.appendChild(header);

  const host = document.createElement("div");
  host.className = "quizify-rendered-preview-host";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.appendChild(embeddedReviewStyle());
  shadow.appendChild(previewShellStyle());

  const content = document.createElement("article");
  content.className = "quizify-preview-surface container quizify-cardless";
  const field = document.createElement("section");
  field.className = "quizify-field quizify-side-content";
  field.textContent = "聚焦 Front 或 Back 字段后，这里会显示渲染结果。";
  content.appendChild(field);
  shadow.appendChild(content);
  preview.appendChild(host);
  panel.appendChild(preview);

  syncPreviewTheme(host);
  const owner = panel.__quizifyFloatingOwner || panel.closest("details");
  owner?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open) schedulePreview(true);
  });
}

function currentField() {
  return globalThis.quizifyEditorCurrentField?.() || null;
}

function previewElements() {
  const preview = document.querySelector(".quizify-rendered-preview");
  const host = preview?.querySelector(".quizify-rendered-preview-host");
  return {
    preview,
    host,
    fieldName: preview?.querySelector(".quizify-rendered-preview-field"),
    field: host?.shadowRoot?.querySelector(".quizify-field")
  };
}

function renderPreview(force = false) {
  ensurePreview();
  const { preview, host, fieldName, field } = previewElements();
  const panel = preview?.closest(".quizify-live-preview-panel");
  const owner = panel?.__quizifyFloatingOwner || panel?.closest("details");
  if (!owner?.open) return;

  const current = currentField();
  if (!field || !host) return;
  const dark = syncPreviewTheme(host);
  if (!current) {
    disposePreviewInteractions(field);
    if (fieldName) fieldName.textContent = "未选择字段";
    field.textContent = "请先聚焦要预览的字段。";
    lastRenderKey = null;
    lastRenderTarget = null;
    return;
  }

  if (fieldName) fieldName.textContent = current.name || `字段 ${Number(current.index) + 1}`;
  const source = String(current.value ?? "");
  const renderKey = `${current.index}:${dark ? "dark" : "light"}:${source}`;
  if (!force && renderKey === lastRenderKey && field === lastRenderTarget) return;
  lastRenderKey = renderKey;
  lastRenderTarget = field;

  if (utf8Size(source) > MAX_FIELD_BYTES) {
    disposePreviewInteractions(field);
    field.textContent = "无法预览：当前字段超过 512 KiB 安全上限。";
    return;
  }
  try {
    disposePreviewInteractions(field);
    field.innerHTML = globalThis.Quizify?.renderMarkdown
      ? globalThis.Quizify.renderMarkdown(source)
      : globalThis.myquizify.configureQuizifyMarked(globalThis.marked)(source);
    enhanceOutlineLists(field);
    enhanceMarkdownTables(field);
    field.querySelectorAll("pre > code").forEach(highlightCodeElement);
    renderMathPlaceholders(field, katex);
    initPreviewInteractions(field);
  } catch (error) {
    disposePreviewInteractions(field);
    field.textContent = `预览失败：${error?.message || "未知错误"}`;
  }
}

function schedulePreview(force = false) {
  const owner = document.querySelector(".quizify-preview-menu");
  if (!owner?.open) return;
  clearTimeout(timer);
  timer = setTimeout(() => renderPreview(force), PREVIEW_DEBOUNCE_MS);
}

document.addEventListener("input", () => schedulePreview(), true);
document.addEventListener("focusin", () => schedulePreview(), true);
if (typeof MutationObserver === "function") {
  const themeObserver = new MutationObserver(() => schedulePreview(true));
  for (const element of [document.documentElement, document.body]) {
    if (element) {
      themeObserver.observe(element, {
        attributes: true,
        attributeFilter: ["class"]
      });
    }
  }
}
ensurePreview();
schedulePreview(true);
