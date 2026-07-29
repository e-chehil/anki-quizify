export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = Object.freeze(["en", "zh-CN", "ru"]);
const emptyCatalogs = Object.freeze({
  en: Object.freeze({}),
  "zh-CN": Object.freeze({}),
  ru: Object.freeze({})
});

function catalogs() {
  const value = globalThis.QuizifyI18nCatalogs;
  return value && typeof value === "object" ? value : emptyCatalogs;
}

export function normalizeLocale(value) {
  const raw = String(value || "")
    .trim()
    .replace(/_/g, "-")
    .split(/[.@]/, 1)[0]
    .toLowerCase();
  if (raw === "ru" || raw.startsWith("ru-")) return "ru";
  if (raw === "zh" || raw.startsWith("zh-")) return "zh-CN";
  if (raw === "en" || raw.startsWith("en-")) return "en";
  return DEFAULT_LOCALE;
}

function scriptLocale(root) {
  const scripts = Array.from(root?.document?.scripts || []);
  for (const script of scripts.reverse()) {
    try {
      const url = new URL(script.src, root.document.baseURI);
      if (!/(?:^|\/)(?:_quizify|syntax-tools|editor(?:-preview)?)\.js$/i.test(url.pathname)) {
        continue;
      }
      const value = url.searchParams.get("lang");
      if (value) return value;
    } catch {
      // Ignore inline or malformed script URLs.
    }
  }
  return "";
}

export function detectLocale(root = globalThis) {
  const explicit = root?.quizifyLocale || scriptLocale(root);
  if (explicit) return normalizeLocale(explicit);
  const documentLocale = root?.document?.documentElement?.getAttribute?.("lang");
  if (documentLocale) return normalizeLocale(documentLocale);
  const navigatorLocale = root?.navigator?.languages?.[0] || root?.navigator?.language;
  return normalizeLocale(navigatorLocale);
}

let activeLocale = detectLocale();

export function setLocale(value) {
  activeLocale = normalizeLocale(value);
  return activeLocale;
}

export function getLocale() {
  return activeLocale;
}

function messageFor(key, locale = activeLocale) {
  const normalized = normalizeLocale(locale);
  const available = catalogs();
  return available[normalized]?.[key] ?? available.en?.[key] ?? key;
}

function format(message, values = {}) {
  return String(message).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

export function t(key, values = {}, locale = activeLocale) {
  const message = messageFor(key, locale);
  if (message && typeof message === "object") {
    return format(message.other ?? Object.values(message)[0] ?? key, values);
  }
  return format(message, values);
}

export function pluralCategory(locale, count) {
  const normalized = normalizeLocale(locale);
  const number = Math.abs(Math.trunc(Number(count) || 0));
  if (normalized === "ru") {
    const mod10 = number % 10;
    const mod100 = number % 100;
    if (mod10 === 1 && mod100 !== 11) return "one";
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "few";
    return "many";
  }
  if (normalized === "en" && number === 1) return "one";
  return "other";
}

export function tn(key, count, values = {}, locale = activeLocale) {
  let message = messageFor(key, locale);
  if (message && typeof message === "object") {
    const category = pluralCategory(locale, count);
    message = message[category] ?? message.other ?? Object.values(message)[0] ?? key;
  }
  return format(message, { count, ...values });
}

export function localizeDocument(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll("[data-quizify-i18n]").forEach((element) => {
    element.textContent = t(element.getAttribute("data-quizify-i18n"));
    element.setAttribute("lang", activeLocale);
  });
  for (const attribute of ["aria-label", "placeholder", "title"]) {
    const marker = `data-quizify-i18n-${attribute}`;
    root.querySelectorAll(`[${marker}]`).forEach((element) => {
      element.setAttribute(attribute, t(element.getAttribute(marker)));
      element.setAttribute("lang", activeLocale);
    });
  }
  root.documentElement?.setAttribute?.("data-quizify-locale", activeLocale);
}
