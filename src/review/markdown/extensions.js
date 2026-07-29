import {
  fenceMarker,
  nextFence
} from "../../shared/markdown-structure.js";
import {
  KATEX_BLOCK_DELIMITERS,
  KATEX_DELIMITERS,
  MATH_PLACEHOLDER_CLASS,
  findDisplayMathEndOnLine,
  findMathRanges,
  matchMathDelimiter
} from "../../shared/math.js";
import { createParserTools } from "./parsers.js";
import { t } from "../../shared/i18n.js";
import { iconSvg } from "../../shared/icons.js";

export function createMarkdownTools(state) {
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, "&#10;");
  }

  function mathPlaceholder(match, forceInline = false) {
    const tag = forceInline || !match.display ? "span" : "div";
    return (
      `<${tag} class="${MATH_PLACEHOLDER_CLASS}" data-quizify-math="${match.display ? "display" : "inline"}" ` +
      `data-quizify-math-left="${escapeAttr(match.left)}" data-quizify-math-right="${escapeAttr(match.right)}">` +
      `${escapeHtml(match.text)}</${tag}>`
    );
  }

  function validMathBlockEnd(source, offset) {
    return findDisplayMathEndOnLine(source, offset);
  }

  const ignoredRawMathElements = new Set([
    "code",
    "pre",
    "script",
    "style",
    "textarea",
    "option",
    "noscript",
    "kbd",
    "title",
    "template"
  ]);
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "source",
    "track",
    "wbr"
  ]);
  const rawHtmlTagHeadPattern = /<(\/)?([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/y;

  function readRawHtmlMarkup(source, start) {
    const special = [
      ["<!--", "-->"],
      ["<![CDATA[", "]]>"]
    ].find(([left]) => source.startsWith(left, start));
    if (special) {
      const end = source.indexOf(special[1], start + special[0].length);
      return { end: end < 0 ? source.length : end + special[1].length };
    }

    rawHtmlTagHeadPattern.lastIndex = start;
    const head = rawHtmlTagHeadPattern.exec(source);
    const declaration = !head && source[start] === "<" &&
      (source[start + 1] === "!" || source[start + 1] === "?");
    if (!head && !declaration) return;

    let quote = "";
    let end = source.length;
    for (let index = start + 2; index < source.length; index++) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        end = index + 1;
        break;
      }
    }

    if (!head) return { end };
    const name = head[2].toLowerCase();
    return {
      end,
      name,
      closing: Boolean(head[1]),
      // In the HTML syntax used by Marked and the browser, a trailing slash
      // does not self-close a non-void element (`<code/>` still opens code).
      selfClosing: voidElements.has(name)
    };
  }

  function renderMathInRawHtml(source) {
    const text = String(source ?? "");
    const stack = [];
    const positions = new Map();
    const ignoredTextRanges = [];
    let ignoredDepth = 0;
    let textStart = 0;
    let index = 0;

    const removeStackFrom = (index) => {
      while (stack.length > index) {
        const name = stack.pop();
        const entries = positions.get(name);
        entries?.pop();
        if (!entries?.length) positions.delete(name);
        if (ignoredRawMathElements.has(name)) ignoredDepth--;
      }
    };

    const pushStack = (name) => {
      const entries = positions.get(name) || [];
      entries.push(stack.length);
      positions.set(name, entries);
      stack.push(name);
    };

    while (index < text.length) {
      if (text[index] !== "<") {
        index++;
        continue;
      }
      const markup = readRawHtmlMarkup(text, index);
      if (!markup) {
        index++;
        continue;
      }

      if (ignoredDepth > 0 && textStart < index) {
        ignoredTextRanges.push({ start: textStart, end: index });
      }
      if (markup.name) {
        if (markup.closing) {
          const entries = positions.get(markup.name);
          const parent = entries?.length ? entries[entries.length - 1] : -1;
          if (parent >= 0) removeStackFrom(parent);
        } else if (!markup.selfClosing) {
          if (
            markup.name === "option" &&
            stack[stack.length - 1] === "option"
          ) {
            removeStackFrom(stack.length - 1);
          }
          pushStack(markup.name);
          if (ignoredRawMathElements.has(markup.name)) ignoredDepth++;
        }
      }
      index = markup.end;
      textStart = index;
    }
    if (ignoredDepth > 0 && textStart < text.length) {
      ignoredTextRanges.push({ start: textStart, end: text.length });
    }

    // Resolve formulas once against the complete raw-HTML token. Restarting
    // the dollar scanner for every text node can reuse the rejected closer of
    // `$a <span>…</span> b$` as an opener and steal a later valid formula.
    const matches = findMathRanges(text);
    let ignoredIndex = 0;
    let cursor = 0;
    let rendered = "";
    for (const match of matches) {
      while (ignoredTextRanges[ignoredIndex]?.end <= match.index) ignoredIndex++;
      const ignored = ignoredTextRanges[ignoredIndex];
      if (ignored && ignored.start <= match.index && match.end <= ignored.end) {
        continue;
      }
      rendered += text.slice(cursor, match.index) + mathPlaceholder(match, true);
      cursor = match.end;
    }
    return rendered + text.slice(cursor);
  }

  const builtinInlineTokens = new Set([
    "br",
    "checkbox",
    "codespan",
    "del",
    "em",
    "escape",
    "html",
    "image",
    "link",
    "strong",
    "text"
  ]);

  function literalizeImageAlt(tokens = []) {
    return tokens.map((token) => {
      if (!builtinInlineTokens.has(token.type)) {
        const literal = String(token.raw ?? `${token.left || ""}${token.text || ""}${token.right || ""}`);
        return { type: "text", raw: literal, text: literal, escaped: false };
      }
      if (Array.isArray(token.tokens)) {
        token.tokens = literalizeImageAlt(token.tokens);
      }
      return token;
    });
  }

  function literalizeInteractiveLinkTokens(tokens = []) {
    const interactive = new Set(["fitb", "reveal", "annotation"]);
    return tokens.map((token) => {
      if (interactive.has(token.type)) {
        const literal = String(token.raw ?? token.text ?? "");
        return { type: "text", raw: literal, text: literal, escaped: false };
      }
      if (Array.isArray(token.tokens)) {
        token.tokens = literalizeInteractiveLinkTokens(token.tokens);
      }
      return token;
    });
  }

  function maskAtomicBracketsForBuiltinLink(source) {
    const text = String(source ?? "");
    const labelStart = text.startsWith("![")
      ? 2
      : text.startsWith("[")
        ? 1
        : -1;
    if (labelStart < 0) {
      return { source: text, restore: (value) => String(value ?? "") };
    }

    let depth = 1;
    let labelEnd = -1;
    for (let index = labelStart; index < text.length; index++) {
      if (text[index] === "\\") {
        index++;
      } else if (text[index] === "[") {
        depth++;
      } else if (text[index] === "]" && --depth === 0) {
        labelEnd = index + 1;
        break;
      }
    }
    if (labelEnd < 0) {
      return { source: text, restore: (value) => String(value ?? "") };
    }

    const label = text.slice(0, labelEnd);
    const mathRanges = findMathRanges(label)
      .filter((match) => match.index >= labelStart && match.end < labelEnd)
      .map((match) => ({ start: match.index, end: match.end }));
    const revealPattern = /\[\[(.*?)\|\|(.*?)\]\]/g;
    const revealRanges = [];
    let reveal;
    while ((reveal = revealPattern.exec(label))) {
      revealRanges.push({ start: reveal.index, end: reveal.index + reveal[0].length });
    }
    if (!mathRanges.length && !revealRanges.length) {
      return { source: text, restore: (value) => String(value ?? "") };
    }

    // Marked's built-in link tokenizer supports one nested bracket pair. A
    // Quizify reveal uses two (`[[question||answer]]`), so an otherwise valid
    // outer Markdown link is rejected before our safe-link policy can run.
    // TeX array/index syntax can also exceed that nesting limit. Temporarily
    // replace only brackets owned by complete math/reveal ranges with unused,
    // same-width BMP characters. The built-in tokenizer still owns the outer
    // label and all destination/title parsing.
    const used = new Set();
    for (let index = 0; index < label.length; index++) {
      used.add(label.charCodeAt(index));
    }
    const markers = [];
    for (let code = 0xe000; code <= 0xf8ff && markers.length < 2; code++) {
      if (!used.has(code)) markers.push(String.fromCharCode(code));
    }
    if (markers.length < 2) {
      return { source: text, restore: (value) => String(value ?? "") };
    }

    const [openMarker, closeMarker] = markers;
    // Scanner offsets are UTF-16 code units; split("") preserves that exact
    // indexing even when an emoji occurs before a bracketed TeX expression.
    const characters = label.split("");
    for (const range of [...mathRanges, ...revealRanges]) {
      for (let index = range.start; index < range.end; index++) {
        if (characters[index] === "[") characters[index] = openMarker;
        else if (characters[index] === "]") characters[index] = closeMarker;
      }
    }
    const maskedLabel = characters.join("");
    if (maskedLabel === label) {
      return { source: text, restore: (value) => String(value ?? "") };
    }
    return {
      source: maskedLabel + text.slice(labelEnd),
      restore(value) {
        return String(value ?? "")
          .split(openMarker)
          .join("[")
          .split(closeMarker)
          .join("]");
      }
    };
  }

  function tokenizeBuiltinLink(context, src) {
    const tokenizer = context.lexer.tokenizer;
    const links = context.lexer.tokens?.links || Object.create(null);
    const direct = tokenizer.link(src);
    if (direct) return direct;

    const reference = tokenizer.reflink(src, links);
    if (reference?.type === "link" || reference?.type === "image") {
      return reference;
    }

    const masked = maskAtomicBracketsForBuiltinLink(src);
    if (masked.source === src) return;
    let token = tokenizer.link(masked.source);
    if (!token) {
      token = tokenizer.reflink(masked.source, links);
      if (token?.type !== "link" && token?.type !== "image") return;
    }

    // The mask is code-unit preserving, so the consumed prefix maps exactly
    // back to the original input. Restore every user-facing string before the
    // token reaches rendering or sanitization.
    token.raw = src.slice(0, token.raw.length);
    token.text = masked.restore(token.text);
    const seen = new WeakSet();
    const restoreTokenValues = (value) => {
      if (!value || typeof value !== "object" || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === "string") {
          value[key] = masked.restore(child);
        } else {
          restoreTokenValues(child);
        }
      }
    };
    restoreTokenValues(token.tokens);
    return token;
  }

  function createQuizifyRenderer() {
    return {
      html(token) {
        if (token.block && !token.pre) {
          const rendered = renderMathInRawHtml(token.text);
          token.text = rendered;
          token.raw = rendered;
        }
        return false;
      },
      image(token) {
        token.tokens = literalizeImageAlt(token.tokens);
        return false;
      }
    };
  }

  const {
    canArmReciteTouchScrub,
    canReciteScrub,
    flattenChoiceTokens,
    flattenTabTokens,
    inlineTokens,
    isReciteScrubMove,
    markerStart,
    nextName,
    parseChoiceBlock,
    parseChoiceOptions,
    parseReciteBlock,
    parseReciteOptions,
    parseTabsBlock,
    readLine,
    regexStart,
    trimBlankEdges,
    tokenizeReciteText
  } = createParserTools(state);

  function createQuizifyExtensions() {
    function inlineExtensionStart(src) {
      const text = String(src ?? "");
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (
          character === "\\" ||
          character === "<" ||
          character === "!" ||
          character === "[" ||
          character === "`" ||
          character === "*" ||
          character === "~" ||
          character === "_"
        ) {
          // Marked's own inline text tokenizer already stops at these
          // boundaries, so it will give every Quizify extension another turn.
          return;
        }
        if (
          character === "$" ||
          character === "^" ||
          (character === "{" && text[index + 1] === "{") ||
          (character === "=" && text[index + 1] === "=")
        ) {
          return index;
        }
      }
    }

    const audioIcons = {
      replay: iconSvg("rotate-ccw", { className: "audio-icon" }),
      play: iconSvg("play", { className: "audio-icon audio-icon-play" }),
      pause: iconSvg("pause", { className: "audio-icon audio-icon-pause" }),
      cancel: iconSvg("x", { className: "audio-icon" })
    };

    const githubAlert = {
      name: "githubAlert",
      level: "block",
      childTokens: ["tokens"],
      start(src) {
        return regexStart(
          src,
          /^(?: {0,3})>[ \t]*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im
        );
      },
      tokenizer(src) {
        const first = readLine(src, 0);
        const opener = /^(?: {0,3})>[ \t]*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*$/i.exec(
          first.line
        );
        if (!opener) return;

        let offset = first.next;
        const lines = [];
        while (offset < src.length) {
          const entry = readLine(src, offset);
          const quoted = /^(?: {0,3})> ?(.*)$/.exec(entry.line);
          if (!quoted) break;
          lines.push(quoted[1]);
          offset = entry.next;
        }

        const kind = opener[1].toLowerCase();
        const labels = {
          note: t("review.alert.note"),
          tip: t("review.alert.tip"),
          important: t("review.alert.important"),
          warning: t("review.alert.warning"),
          caution: t("review.alert.caution")
        };
        return {
          type: "githubAlert",
          raw: src.slice(0, offset),
          kind,
          label: labels[kind],
          tokens: this.lexer.blockTokens(trimBlankEdges(lines).join("\n"))
        };
      },
      renderer(token) {
        const alertIcon = {
          note: "info",
          tip: "lightbulb",
          important: "important",
          warning: "triangle-alert",
          caution: "caution"
        }[token.kind];
        return (
          `<aside class="markdown-alert markdown-alert-${token.kind}">` +
          `<p class="markdown-alert-title">${iconSvg(alertIcon, { className: "markdown-alert-icon" })}${escapeHtml(token.label)}</p>` +
          `${this.parser.parse(token.tokens)}</aside>`
        );
      }
    };

    const recite = {
      name: "recite",
      level: "block",
      childTokens: ["tokens"],
      start(src) {
        return regexStart(src, /^::::[ \t]+recite(?:[ \t]|$)/im);
      },
      tokenizer(src) {
        const parsed = parseReciteBlock(src, this.lexer);
        if (!parsed) return;
        return { type: "recite", ...parsed };
      },
      renderer(token) {
        return (
          `<section class="quizify-recite" data-mask="${token.mask}" data-mode="${escapeAttr(token.mode)}" data-scrub-label="${escapeAttr(t("review.recite.scrub_hint"))}">` +
          `<div class="quizify-recite-content">${this.parser.parse(token.tokens)}</div>` +
          '<footer class="quizify-recite-toolbar">' +
          `<label class="quizify-recite-slider"><span>${escapeHtml(t("review.recite.mask"))}</span>` +
          `<input type="range" min="0" max="100" step="5" value="${token.mask}" aria-label="${escapeAttr(t("review.recite.mask_ratio"))}">` +
          `<output>${token.mask}%</output></label>` +
          `<button type="button" class="quizify-recite-shuffle" data-quizify-control="recite-shuffle" aria-label="${escapeAttr(t("review.recite.shuffle_label"))}">${iconSvg("shuffle", { className: "quizify-recite-shuffle-icon" })}<span>${escapeHtml(t("review.recite.shuffle"))}</span></button>` +
          '</footer></section>'
        );
      }
    };

    const collapse = {
      name: "collapse",
      level: "block",
      childTokens: ["titleTokens", "tokens"],
      start(src) {
        return markerStart(src, ":::");
      },
      tokenizer(src) {
        const opener = /^:::[^\S\r\n]+(.+?)\s*\n/.exec(src);
        if (!opener) return;

        const title = opener[1].trim();
        let depth = 1;
        let offset = opener[0].length;
        const lines = [];
        let fence = null;
        let mathEnd = -1;

        while (depth > 0 && offset < src.length) {
          const insideMath =
            !fence &&
            (offset < mathEnd ||
              ((mathEnd = validMathBlockEnd(src, offset)) > offset));
          const entry = readLine(src, offset);
          offset = entry.next;

          if (insideMath) {
            lines.push(entry.line);
          } else if (fence) {
            lines.push(entry.line);
            fence = nextFence(entry.line, fence);
          } else if (fenceMarker(entry.line)) {
            lines.push(entry.line);
            fence = nextFence(entry.line, fence);
          } else if (/^:::\s*$/.test(entry.line)) {
            depth--;
            if (depth === 0) break;
            lines.push(entry.line);
          } else if (/^:::\s+\S/.test(entry.line)) {
            depth++;
            lines.push(entry.line);
          } else {
            lines.push(entry.line);
          }
        }

        if (depth !== 0) return;

        return {
          type: "collapse",
          raw: src.slice(0, offset),
          title,
          titleTokens: inlineTokens(this.lexer, title),
          tokens: this.lexer.blockTokens(trimBlankEdges(lines).join("\n"))
        };
      },
      renderer(token) {
        return (
          "<details>" +
          `<summary>${this.parser.parseInline(token.titleTokens)}${iconSvg("chevron-down", { className: "quizify-collapse-icon" })}</summary>` +
          `<div class="collapse-content">${this.parser.parse(token.tokens)}</div>` +
          "</details>"
        );
      }
    };

    const tabs = {
      name: "tabs",
      level: "block",
      childTokens: ["titleTokens", "tokens"],
      start(src) {
        return markerStart(src, "===");
      },
      tokenizer(src) {
        const parsed = parseTabsBlock(src, this.lexer);
        if (!parsed) return;
        return {
          type: "tabs",
          raw: parsed.raw,
          tabs: parsed.tabs,
          titleTokens: flattenTabTokens(parsed.tabs, "titleTokens"),
          tokens: flattenTabTokens(parsed.tabs, "tokens")
        };
      },
      renderer(token) {
        const groupId = nextName("tabs");
        const nav = token.tabs
          .map((tab, index) => {
            const active = index === 0 ? " active" : "";
            const tabId = `${groupId}-tab-${index}`;
            const paneId = `${groupId}-panel-${index}`;
            return `<div id="${tabId}" class="tab-button${active}" role="tab" tabindex="${index === 0 ? "0" : "-1"}" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="${paneId}">${this.parser.parseInline(tab.titleTokens)}</div>`;
          })
          .join("");

        const panes = token.tabs
          .map((tab, index) => {
            const active = index === 0 ? " active" : "";
            const tabId = `${groupId}-tab-${index}`;
            const paneId = `${groupId}-panel-${index}`;
            return `<div id="${paneId}" class="tab-pane${active}" role="tabpanel" aria-labelledby="${tabId}" aria-hidden="${index === 0 ? "false" : "true"}">${this.parser.parse(tab.tokens)}</div>`;
          })
          .join("");

        return `<div class="tabs-container"><nav class="tabs-nav" role="tablist" aria-label="${escapeAttr(t("review.tabs"))}">${nav}</nav><div class="tabs-content">${panes}</div></div>`;
      }
    };

    const annotation = {
      name: "annotation",
      level: "inline",
      childTokens: ["textTokens", "tooltipTokens"],
      tokenizer(src) {
        if (!src.startsWith("[")) return;
        let middle = -1;
        for (let index = 1; index < src.length; index++) {
          if (src[index] === "\n" || src[index] === "\r" || src[index] === "[") {
            return;
          }
          if (src.startsWith("]^(", index)) {
            middle = index;
            break;
          }
        }
        if (middle <= 1) return;
        const end = src.indexOf(")^", middle + 3);
        if (
          end <= middle + 3 ||
          /[\r\n]/.test(src.slice(middle + 3, end))
        ) return;
        const raw = src.slice(0, end + 2);
        return {
          type: "annotation",
          raw,
          textTokens: inlineTokens(this.lexer, src.slice(1, middle)),
          tooltipTokens: inlineTokens(this.lexer, src.slice(middle + 3, end))
        };
      },
      renderer(token) {
        const tooltipId = nextName("annotation-tooltip");
        return (
          `<span class="annotation" role="button" tabindex="0" aria-expanded="false" aria-controls="${escapeAttr(tooltipId)}" aria-describedby="${escapeAttr(tooltipId)}" aria-label="${escapeAttr(t("review.annotation.show"))}" title="${escapeAttr(t("review.annotation.show"))}">` +
          `<span class="annotation-label">${this.parser.parseInline(token.textTokens)}</span>` +
          `<span id="${escapeAttr(tooltipId)}" class="tooltip" role="tooltip" aria-hidden="true"><span class="tooltip-content">${this.parser.parseInline(token.tooltipTokens)}</span></span></span>`
        );
      }
    };

    const highlight = {
      name: "highlight",
      level: "inline",
      childTokens: ["tokens"],
      tokenizer(src) {
        const match = /^==(?=\S)([^\n]*?\S)==/.exec(src);
        if (!match) return;
        return {
          type: "highlight",
          raw: match[0],
          tokens: inlineTokens(this.lexer, match[1])
        };
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
      }
    };

    const fitb = {
      name: "fitb",
      level: "inline",
      tokenizer(src) {
        const match = /^\{\{(.*?)\}\}/.exec(src);
        if (!match) return;
        return {
          type: "fitb",
          raw: match[0],
          answer: match[1].trim(),
          inputName: nextName("fitb")
        };
      },
      renderer(token) {
        return (
          `<span class="fitb" data-answer="${escapeAttr(token.answer)}">` +
          `<input type="text" name="${escapeAttr(token.inputName)}" data-answer="${escapeAttr(token.answer)}" placeholder="${escapeAttr(t("review.fitb.placeholder"))}">` +
          `<button type="button" class="feedback-icon" data-quizify-control="fitb-reveal" aria-label="${escapeAttr(t("review.fitb.reveal_answer"))}" title="${escapeAttr(t("review.fitb.reveal_answer"))}">${iconSvg("eye", { className: "fitb-feedback-symbol" })}</button></span>`
        );
      }
    };

    const reveal = {
      name: "reveal",
      level: "inline",
      childTokens: ["questionTokens", "answerTokens"],
      tokenizer(src) {
        if (!src.startsWith("[[")) return;
        const lineEnd = (() => {
          const newline = src.search(/[\r\n]/);
          return newline < 0 ? src.length : newline;
        })();
        const separator = src.indexOf("||", 2);
        const end = separator < 0 ? -1 : src.indexOf("]]", separator + 2);
        if (
          separator < 0 ||
          separator >= lineEnd ||
          end < 0 ||
          end >= lineEnd
        ) {
          let literalEnd = 2;
          while (src[literalEnd] === "[") literalEnd++;
          return {
            type: "reveal",
            raw: src.slice(0, literalEnd),
            text: src.slice(0, literalEnd),
            literal: true
          };
        }
        return {
          type: "reveal",
          raw: src.slice(0, end + 2),
          questionTokens: inlineTokens(
            this.lexer,
            src.slice(2, separator).trim()
          ),
          answerTokens: inlineTokens(
            this.lexer,
            src.slice(separator + 2, end).trim()
          )
        };
      },
      renderer(token) {
        if (token.literal) return escapeHtml(token.text);
        const secretId = nextName("reveal-answer");
        return (
          `<span class="reveal" role="button" tabindex="0" aria-expanded="false" aria-controls="${escapeAttr(secretId)}" aria-label="${escapeAttr(t("review.reveal.show"))}" title="${escapeAttr(t("review.reveal.show"))}">` +
          `<span class="reveal-question">${this.parser.parseInline(token.questionTokens)}</span>` +
          `${iconSvg("reveal-card", { className: "reveal-icon" })}` +
          `<span id="${escapeAttr(secretId)}" class="secret" aria-hidden="true">${this.parser.parseInline(token.answerTokens)}</span></span>`
        );
      }
    };

    const superscript = {
      name: "superscript",
      level: "inline",
      childTokens: ["tokens"],
      tokenizer(src) {
        const match = /^\^([^^\n]+?)\^/.exec(src);
        if (!match || !match[1].trim()) return;
        return {
          type: "superscript",
          raw: match[0],
          tokens: inlineTokens(this.lexer, match[1])
        };
      },
      renderer(token) {
        return `<sup>${this.parser.parseInline(token.tokens)}</sup>`;
      }
    };

    const subscript = {
      name: "subscript",
      level: "inline",
      childTokens: ["tokens"],
      tokenizer(src) {
        if (src.startsWith("~~")) return;
        const match = /^~([^~\n]+?)~/.exec(src);
        if (!match || !match[1].trim()) return;
        return {
          type: "subscript",
          raw: match[0],
          tokens: inlineTokens(this.lexer, match[1])
        };
      },
      renderer(token) {
        return `<sub>${this.parser.parseInline(token.tokens)}</sub>`;
      }
    };

    const mcq = {
      name: "mcq",
      level: "block",
      start(src) {
        return markerStart(src, ";;;");
      },
      tokenizer(src) {
        const parsed = parseChoiceBlock(src, this.lexer);
        if (!parsed) return;

        return {
          type: "mcq",
          raw: parsed.raw,
          options: parsed.options,
          correct: parsed.correct,
          isSingle: parsed.correct.length === 1,
          inputName: nextName("mcq"),
          tokens: flattenChoiceTokens(parsed.options)
        };
      },
      renderer(token) {
        const inputType = token.isSingle ? "radio" : "checkbox";
        const typeLabel = t(
          token.isSingle ? "review.choice.single" : "review.choice.multiple"
        );
        const optionsHtml = token.options
          .map((option) => {
            return (
              `<label class="option" data-option="${escapeAttr(option.letter)}">` +
              `<input type="${inputType}" name="${escapeAttr(token.inputName)}" value="${escapeAttr(option.letter)}">` +
              `<span class="checkmark" aria-hidden="true">${iconSvg("check", { className: "choice-check-icon" })}</span>` +
              `<span class="option-text">${this.parser.parseInline(option.tokens)}</span></label>`
            );
          })
          .join("");

        return (
          `<div class="choice" data-correct="${escapeAttr(token.correct)}" data-quizify-kind="${token.isSingle ? "single" : "multiple"}">` +
          `<div class="options">${optionsHtml}</div>` +
          `<button type="button" class="feedback" data-quizify-control="choice-feedback" data-correct="${escapeAttr(token.correct)}" data-is-answered="false">${escapeHtml(t("review.choice.show_answer", { type: typeLabel }))}</button>` +
          "</div>"
        );
      }
    };

    const audio = {
      name: "audio",
      level: "block",
      start(src) {
        return markerStart(src, "!audio[");
      },
      tokenizer(src) {
        const match = /^!audio\[(.*?)\]\((.*?)\)/.exec(src);
        if (!match) return;
        return {
          type: "audio",
          raw: match[0],
          title: match[1].trim(),
          url: match[2].trim()
        };
      },
      renderer(token) {
        return (
          `<div class="audio-player" data-title="${escapeAttr(token.title)}" data-kind-label="${escapeAttr(t("review.audio.kind"))}">` +
          `<audio preload="metadata"><source src="${escapeAttr(token.url)}" type="audio/mpeg"></audio>` +
          '<div class="time-display"><span class="current-time">0:00</span><span class="duration">0:00</span></div>' +
          `<div class="progress-container" role="slider" tabindex="0" aria-label="${escapeAttr(t("review.audio.progress"))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar"></div></div>` +
          '<div class="player-controls">' +
          `<button type="button" class="replay-btn" data-quizify-control="audio-replay" title="${escapeAttr(t("review.audio.replay"))}" aria-label="${escapeAttr(t("review.audio.replay"))}">${audioIcons.replay}</button>` +
          `<button type="button" class="play-btn" data-quizify-control="audio-toggle" title="${escapeAttr(t("review.audio.play"))}" aria-label="${escapeAttr(t("review.audio.play"))}">${audioIcons.play}${audioIcons.pause}</button>` +
          `<button type="button" class="setA-btn" data-quizify-control="audio-loop-start" title="${escapeAttr(t("review.audio.set_a"))}" aria-label="${escapeAttr(t("review.audio.set_a"))}" aria-pressed="false"><span class="audio-letter">A</span></button>` +
          `<button type="button" class="setB-btn" data-quizify-control="audio-loop-end" title="${escapeAttr(t("review.audio.set_b"))}" aria-label="${escapeAttr(t("review.audio.set_b"))}" aria-pressed="false"><span class="audio-letter">B</span></button>` +
          `<button type="button" class="cancelLoop-btn" data-quizify-control="audio-loop-cancel" title="${escapeAttr(t("review.audio.cancel_loop"))}" aria-label="${escapeAttr(t("review.audio.cancel_loop"))}">${audioIcons.cancel}</button>` +
          `<select class="speed-select" aria-label="${escapeAttr(t("review.audio.speed"))}"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select>` +
          "</div></div>"
        );
      }
    };

    const mathSequences = Array.from(
      new Set(
        KATEX_DELIMITERS.flatMap((delimiter) => [delimiter.left, delimiter.right])
      )
    ).sort((left, right) => right.length - left.length);

    function malformedMathLiteralLength(src, delimiter) {
      const markdownBoundary = new Set([
        "`",
        "*",
        "_",
        "~",
        "^",
        "=",
        "[",
        "<",
        "!",
        "&",
        "|",
        ";"
      ]);
      let index = delimiter.left.length;

      while (index < src.length) {
        const mathSequence = mathSequences.find((sequence) =>
          src.startsWith(sequence, index)
        );
        // Leave the next delimiter candidate to the extension scheduler. This
        // both preserves a later valid formula and makes recovery from many
        // malformed openers a single forward pass over the field.
        if (mathSequence) break;
        const character = src[index];
        if (
          character === "\\" ||
          markdownBoundary.has(character) ||
          (character === "{" && src[index + 1] === "{")
        ) {
          break;
        }
        index++;
      }
      return Math.max(delimiter.left.length, index);
    }

    const mathInline = {
      name: "mathInline",
      level: "inline",
      start(src) {
        // Scan only until a boundary where Marked will stop by itself. This
        // keeps mixed Markdown/link-heavy fields linear while still exposing
        // custom markers that its normal text rule would otherwise consume.
        return inlineExtensionStart(src);
      },
      tokenizer(src) {
        const delimiter = KATEX_DELIMITERS.find((candidate) =>
          src.startsWith(candidate.left)
        );
        if (!delimiter) return;

        const match = matchMathDelimiter(src, KATEX_DELIMITERS);
        if (!match) {
          const length = malformedMathLiteralLength(src, delimiter);
          return {
            type: "mathInline",
            raw: src.slice(0, length),
            text: src.slice(0, length),
            literal: true
          };
        }
        return { type: "mathInline", ...match };
      },
      renderer(token) {
        if (token.literal) return escapeHtml(token.text);
        return mathPlaceholder(token, true);
      }
    };

    const mathBlock = {
      name: "mathBlock",
      level: "block",
      start(src) {
        // Marked calls block start hints with src.substring(1), so a hint
        // cannot safely infer whether a mid-paragraph delimiter was originally
        // inside a link, code span, or HTML element. Only advertise delimiters
        // that begin a physical line; inline math owns every other position.
        return regexStart(src, /^(?: {0,3})(?:\$\$|\\\[)/m);
      },
      tokenizer(src) {
        const opener = /^( {0,3})(?=\$\$|\\\[)/.exec(src);
        if (!opener) return;
        const match = matchMathDelimiter(
          src.slice(opener[1].length),
          KATEX_BLOCK_DELIMITERS
        );
        if (!match) return;
        return {
          type: "mathBlock",
          ...match,
          raw: src.slice(0, opener[1].length + match.raw.length)
        };
      },
      renderer(token) {
        return `${mathPlaceholder(token)}\n`;
      }
    };

    const rawIgnoredElement = {
      name: "rawIgnoredElement",
      level: "inline",
      tokenizer(src) {
        const opening = readRawHtmlMarkup(src, 0);
        if (
          !opening?.name ||
          opening.closing ||
          !ignoredRawMathElements.has(opening.name)
        ) {
          return;
        }
        if (opening.selfClosing) {
          return {
            type: "rawIgnoredElement",
            raw: src.slice(0, opening.end)
          };
        }
        if (opening.name === "option") {
          const optionClose = /<\/option\s*>|<option(?=[\s>])|<\/select\s*>/ig;
          optionClose.lastIndex = opening.end;
          const boundary = optionClose.exec(src);
          const end = !boundary
            ? src.length
            : /^<\/option/i.test(boundary[0])
              ? boundary.index + boundary[0].length
              : boundary.index;
          return { type: "rawIgnoredElement", raw: src.slice(0, end) };
        }
        const closePattern = new RegExp(`</${opening.name}\\s*>`, "ig");
        closePattern.lastIndex = opening.end;
        const closing = closePattern.exec(src);
        const end = closing ? closing.index + closing[0].length : src.length;
        return { type: "rawIgnoredElement", raw: src.slice(0, end) };
      },
      renderer(token) {
        return token.raw;
      }
    };

    const literalImage = {
      name: "literalImage",
      level: "inline",
      tokenizer(src) {
        if (!src.startsWith("![")) return;
        const fitbCounter = state.fitbCounter;
        try {
          const token = tokenizeBuiltinLink(this, src);
          if (!token || token.type !== "image") return;
          token.tokens = [
            { type: "text", raw: token.text, text: token.text, escaped: false }
          ];
          return token;
        } finally {
          state.fitbCounter = fitbCounter;
        }
      }
    };

    const safeLink = {
      name: "safeLink",
      level: "inline",
      tokenizer(src) {
        if (!src.startsWith("[") || src.startsWith("[[")) return;
        const fitbCounter = state.fitbCounter;
        try {
          const token = tokenizeBuiltinLink(this, src);
          if (!token || token.type !== "link") return;
          // Keep the built-in label tokenization (including its link context)
          // so math remains functional, then flatten only controls that would
          // create invalid interactive descendants inside <a>.
          token.tokens = literalizeInteractiveLinkTokens(token.tokens);
          return token;
        } finally {
          state.fitbCounter = fitbCounter;
        }
      }
    };

    return [
      githubAlert,
      recite,
      collapse,
      tabs,
      annotation,
      highlight,
      fitb,
      reveal,
      superscript,
      subscript,
      mcq,
      audio,
      mathInline,
      mathBlock,
      rawIgnoredElement,
      literalImage,
      safeLink
    ];
  }

  return Object.freeze({
    canArmReciteTouchScrub,
    canReciteScrub,
    createQuizifyExtensions,
    createQuizifyRenderer,
    escapeHtml,
    isReciteScrubMove,
    markerStart,
    parseChoiceBlock,
    parseChoiceOptions,
    parseReciteBlock,
    parseReciteOptions,
    parseTabsBlock,
    tokenizeReciteText
  });
}
