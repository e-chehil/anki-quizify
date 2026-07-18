import { editorBundleUrl } from "./runtime-config.js";

let previewPromise = null;

function previewBundleUrl() {
  if (!editorBundleUrl) return null;
  const previewUrl = new URL("editor-preview.js", editorBundleUrl);
  previewUrl.search = editorBundleUrl.search;
  return previewUrl.href;
}

globalThis.quizifyLoadEditorPreview = () => {
  if (globalThis.quizifyEditorPreviewReady) return Promise.resolve(true);
  if (previewPromise) return previewPromise;
  const source = previewBundleUrl();
  if (!source) return Promise.reject(new Error("找不到 Quizify 预览资源地址"));

  previewPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = source;
    script.async = true;
    script.addEventListener("load", () => resolve(true), { once: true });
    script.addEventListener("error", () => {
      previewPromise = null;
      reject(new Error("Quizify 预览资源加载失败"));
    }, { once: true });
    document.head.appendChild(script);
  });
  return previewPromise;
};
