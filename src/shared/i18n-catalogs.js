import en from "../../quizify_addon/locales/en.json" with { type: "json" };
import zhCN from "../../quizify_addon/locales/zh-CN.json" with { type: "json" };
import ru from "../../quizify_addon/locales/ru.json" with { type: "json" };

// Keep the comparatively large catalogs in one classic-script bundle. Review,
// editor and preview runtimes then share the same in-memory object instead of
// embedding three copies in every generated JavaScript file.
globalThis.QuizifyI18nCatalogs = Object.freeze({
  en: Object.freeze(en),
  "zh-CN": Object.freeze(zhCN),
  ru: Object.freeze(ru)
});
