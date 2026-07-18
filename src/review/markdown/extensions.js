import {
  fenceMarker,
  nextFence
} from "../../shared/markdown-structure.js";
import { createParserTools } from "./parsers.js";

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
    const audioIcons = {
      replay:
        '<svg class="audio-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M7.2 7.2A7 7 0 1 1 5 12h2.2A4.8 4.8 0 1 0 8.6 8.6L11 11H4V4l3.2 3.2z"></path>' +
        "</svg>",
      play:
        '<svg class="audio-icon audio-icon-play" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M8 5.5v13l10-6.5-10-6.5z"></path>' +
        "</svg>",
      pause:
        '<svg class="audio-icon audio-icon-pause" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M7 5.5h4v13H7v-13zm6 0h4v13h-4v-13z"></path>' +
        "</svg>",
      cancel:
        '<svg class="audio-icon" viewBox="0 0 24 24" aria-hidden="true">' +
        '<path d="M7.4 5.9 12 10.6l4.6-4.7 1.5 1.5-4.7 4.6 4.7 4.6-1.5 1.5-4.6-4.7-4.6 4.7-1.5-1.5 4.7-4.6-4.7-4.6 1.5-1.5z"></path>' +
        "</svg>"
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
          note: "Note",
          tip: "Tip",
          important: "Important",
          warning: "Warning",
          caution: "Caution"
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
        return (
          `<aside class="markdown-alert markdown-alert-${token.kind}">` +
          `<p class="markdown-alert-title">${token.label}</p>` +
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
          `<section class="quizify-recite" data-mask="${token.mask}" data-mode="${escapeAttr(token.mode)}">` +
          `<div class="quizify-recite-content">${this.parser.parse(token.tokens)}</div>` +
          '<footer class="quizify-recite-toolbar">' +
          '<label class="quizify-recite-slider"><span>遮挡</span>' +
          `<input type="range" min="0" max="100" step="5" value="${token.mask}" aria-label="背诵遮挡比例">` +
          `<output>${token.mask}%</output></label>` +
          '<button type="button" class="quizify-recite-shuffle" aria-label="重新随机遮挡">↻ 洗牌</button>' +
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

        while (depth > 0 && offset < src.length) {
          const entry = readLine(src, offset);
          offset = entry.next;

          if (fence) {
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
          `<summary>${this.parser.parseInline(token.titleTokens)}</summary>` +
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

        return `<div class="tabs-container"><nav class="tabs-nav" role="tablist" aria-label="内容标签页">${nav}</nav><div class="tabs-content">${panes}</div></div>`;
      }
    };

    const annotation = {
      name: "annotation",
      level: "inline",
      childTokens: ["textTokens", "tooltipTokens"],
      start(src) {
        return regexStart(src, /\[.*?\]\^\(.*?\)\^/);
      },
      tokenizer(src) {
        const match = /^\[(.+?)\]\^\((.+?)\)\^/.exec(src);
        if (!match) return;
        return {
          type: "annotation",
          raw: match[0],
          textTokens: inlineTokens(this.lexer, match[1]),
          tooltipTokens: inlineTokens(this.lexer, match[2])
        };
      },
      renderer(token) {
        return (
          `<span class="annotation">${this.parser.parseInline(token.textTokens)}` +
          `<span class="tooltip">${this.parser.parseInline(token.tooltipTokens)}</span></span>`
        );
      }
    };

    const highlight = {
      name: "highlight",
      level: "inline",
      childTokens: ["tokens"],
      start(src) {
        return markerStart(src, "==");
      },
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
      start(src) {
        return markerStart(src, "{{");
      },
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
          `<input type="text" name="${escapeAttr(token.inputName)}" data-answer="${escapeAttr(token.answer)}" placeholder="请输入答案">` +
          '<span class="feedback-icon" role="button" tabindex="0"></span></span>'
        );
      }
    };

    const reveal = {
      name: "reveal",
      level: "inline",
      childTokens: ["questionTokens", "answerTokens"],
      start(src) {
        return regexStart(src, /\[\[.*?\|\|.*?\]\]/);
      },
      tokenizer(src) {
        const match = /^\[\[(.*?)\|\|(.*?)\]\]/.exec(src);
        if (!match) return;
        return {
          type: "reveal",
          raw: match[0],
          questionTokens: inlineTokens(this.lexer, match[1].trim()),
          answerTokens: inlineTokens(this.lexer, match[2].trim())
        };
      },
      renderer(token) {
        return (
          `<span class="reveal">${this.parser.parseInline(token.questionTokens)}` +
          `<span class="secret">${this.parser.parseInline(token.answerTokens)}</span></span>`
        );
      }
    };

    const superscript = {
      name: "superscript",
      level: "inline",
      childTokens: ["tokens"],
      start(src) {
        return markerStart(src, "^");
      },
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
      start(src) {
        return markerStart(src, "~");
      },
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
        const typeLabel = token.isSingle ? "单选题 | " : "多选题 | ";
        const optionsHtml = token.options
          .map((option) => {
            return (
              `<label class="option" data-option="${escapeAttr(option.letter)}">` +
              `<input type="${inputType}" name="${escapeAttr(token.inputName)}" value="${escapeAttr(option.letter)}">` +
              '<span class="checkmark"></span>' +
              `<span class="option-text">${this.parser.parseInline(option.tokens)}</span></label>`
            );
          })
          .join("");

        return (
          `<div class="choice" data-correct="${escapeAttr(token.correct)}" data-quizify-kind="${token.isSingle ? "single" : "multiple"}">` +
          `<div class="options">${optionsHtml}</div>` +
          `<button type="button" class="feedback" data-correct="${escapeAttr(token.correct)}" data-is-answered="false">${typeLabel}点击显示答案</button>` +
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
          `<div class="audio-player" data-title="${escapeAttr(token.title)}">` +
          `<audio preload="metadata"><source src="${escapeAttr(token.url)}" type="audio/mpeg"></audio>` +
          '<div class="time-display"><span class="current-time">0:00</span><span class="duration">0:00</span></div>' +
          '<div class="progress-container" role="slider" tabindex="0" aria-label="播放进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-bar"></div></div>' +
          '<div class="player-controls">' +
          `<button type="button" class="replay-btn" title="重新播放" aria-label="重新播放">${audioIcons.replay}</button>` +
          `<button type="button" class="play-btn" title="播放" aria-label="播放">${audioIcons.play}${audioIcons.pause}</button>` +
          '<button type="button" class="setA-btn" title="设置 A 点" aria-label="设置 A 点" aria-pressed="false"><span class="audio-letter">A</span></button>' +
          '<button type="button" class="setB-btn" title="设置 B 点" aria-label="设置 B 点" aria-pressed="false"><span class="audio-letter">B</span></button>' +
          `<button type="button" class="cancelLoop-btn" title="取消循环" aria-label="取消循环">${audioIcons.cancel}</button>` +
          '<select class="speed-select" aria-label="播放速度"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select>' +
          "</div></div>"
        );
      }
    };

    const mathInline = {
      name: "mathInline",
      level: "inline",
      start(src) {
        return regexStart(src, /\\\(/);
      },
      tokenizer(src) {
        const match = /^\\\((.+?)\\\)/.exec(src);
        if (!match) return;
        return { type: "mathInline", raw: match[0], text: match[1] };
      },
      renderer(token) {
        return `\\(${escapeHtml(token.text)}\\)`;
      }
    };

    const mathBlock = {
      name: "mathBlock",
      level: "block",
      start(src) {
        return regexStart(src, /\\\[/);
      },
      tokenizer(src) {
        const match = /^\\\[([\s\S]+?)\\\]/.exec(src);
        if (!match) return;
        return { type: "mathBlock", raw: match[0], text: match[1] };
      },
      renderer(token) {
        return `\\[${escapeHtml(token.text)}\\]`;
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
      mathBlock
    ];
  }

  return Object.freeze({
    canArmReciteTouchScrub,
    canReciteScrub,
    createQuizifyExtensions,
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
