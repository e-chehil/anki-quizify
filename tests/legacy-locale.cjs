// Legacy CommonJS runtime tests historically assert the Chinese card UI.
// Pin the locale so their result does not depend on the developer machine.
require("../quizify_addon/_quizify-i18n.js");
globalThis.quizifyLocale = "zh-CN";
