import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  detectLocale,
  getLocale,
  localizeDocument,
  normalizeLocale,
  pluralCategory,
  setLocale,
  t,
  tn
} from "../src/shared/i18n.js";


test("locale normalization follows supported Anki languages and falls back to English", () => {
  assert.equal(normalizeLocale("en_US"), "en");
  assert.equal(normalizeLocale("ru-RU"), "ru");
  assert.equal(normalizeLocale("zh_TW"), "zh-CN");
  assert.equal(normalizeLocale("fr-FR"), "en");
  assert.equal(normalizeLocale(""), "en");
  assert.equal(detectLocale({ quizifyLocale: "ru_RU" }), "ru");
  assert.equal(
    detectLocale({
      document: { documentElement: { getAttribute: () => "zh-HK" }, scripts: [] }
    }),
    "zh-CN"
  );
  assert.equal(detectLocale({ navigator: { language: "de-DE" } }), "en");
});

test("runtime translations switch synchronously and interpolate named values", () => {
  setLocale("ru_RU");
  assert.equal(getLocale(), "ru");
  assert.equal(t("common.cancel"), "Отмена");
  assert.match(t("review.audio.point", { label: "A", time: "0:42" }), /A.*0:42/);
  setLocale("unknown");
  assert.equal(t("common.cancel"), "Cancel");
});

test("English and Russian plural rules cover their distinct categories", () => {
  assert.equal(pluralCategory("en", 1), "one");
  assert.equal(pluralCategory("en", 2), "other");
  for (const [count, category] of [[1, "one"], [2, "few"], [5, "many"], [11, "many"], [21, "one"], [22, "few"]]) {
    assert.equal(pluralCategory("ru", count), category);
  }
  setLocale("ru");
  assert.match(tn("syntax.summary.errors", 2), /2 ошибки/);
  assert.match(tn("syntax.summary.errors", 5), /5 ошибок/);
});

test("declarative card labels are localized without replacing user content", () => {
  const dom = new JSDOM(
    '<!doctype html><span data-quizify-i18n="common.answer">Answer</span><p>user text</p>'
  );
  setLocale("zh-CN");
  localizeDocument(dom.window.document);
  assert.equal(dom.window.document.querySelector("span").textContent, "答案");
  assert.equal(dom.window.document.querySelector("span").getAttribute("lang"), "zh-CN");
  assert.equal(dom.window.document.querySelector("p").textContent, "user text");
});
