/* Shared Quizify authoring syntax analyzer. */
import {
  uniqueSortedLetters
} from "./markdown-structure.js";
import {
  maskMarkdownFencedCode,
  maskMarkdownInlineContexts
} from "./math.js";
import { t, tn } from "./i18n.js";
(function (root, factory) {
  const api = factory();

  if (root) {
    root.QuizifySyntax = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const snippets = [
    [t("editor.snippet.fitb"), t("editor.snippet.fitb.template"), t("editor.placeholder.answer")],
    [t("editor.snippet.choice"), t("editor.snippet.choice.template"), t("editor.placeholder.option_a")],
    [t("editor.snippet.reveal"), t("editor.snippet.reveal.template"), t("editor.placeholder.question")],
    [t("editor.snippet.annotation"), t("editor.snippet.annotation.template"), t("editor.placeholder.content")],
    [t("editor.snippet.collapse"), t("editor.snippet.collapse.template"), t("editor.placeholder.title")],
    [t("editor.snippet.tabs"), t("editor.snippet.tabs.template"), t("editor.placeholder.tab_one")],
    [t("editor.snippet.audio"), t("editor.snippet.audio.template"), t("editor.placeholder.audio_title")],
    [t("editor.snippet.recite"), t("editor.snippet.recite.template"), t("editor.placeholder.recite_text")]
  ];

  const markdownActions = [
    {
      id: "bold",
      label: t("editor.action.bold"),
      button: "B",
      shortcut: "Ctrl+B",
      key: "b",
      prefix: "**",
      suffix: "**",
      placeholder: t("editor.placeholder.bold")
    },
    {
      id: "italic",
      label: t("editor.action.italic"),
      button: "I",
      shortcut: "Ctrl+I",
      key: "i",
      prefix: "*",
      suffix: "*",
      placeholder: t("editor.placeholder.italic")
    },
    {
      id: "inline-code",
      label: t("editor.action.inline_code"),
      button: "</>",
      shortcut: "Ctrl+`",
      key: "`",
      prefix: "`",
      suffix: "`",
      placeholder: t("editor.placeholder.code")
    },
    {
      id: "link",
      label: t("editor.action.link"),
      button: "Link",
      shortcut: "Ctrl+K",
      key: "k",
      prefix: "[",
      suffix: "](url)",
      placeholder: t("editor.placeholder.link_text")
    },
    {
      id: "strikethrough",
      label: t("editor.action.strikethrough"),
      button: "S",
      shortcut: "Ctrl+Shift+X",
      key: "x",
      shift: true,
      prefix: "~~",
      suffix: "~~",
      placeholder: t("editor.placeholder.strikethrough")
    },
    {
      id: "highlight",
      label: t("editor.action.highlight"),
      button: "==",
      shortcut: "Ctrl+Shift+H",
      key: "h",
      shift: true,
      prefix: "==",
      suffix: "==",
      placeholder: t("editor.placeholder.highlight")
    },
    {
      id: "superscript",
      label: t("editor.action.superscript"),
      button: "X²",
      shortcut: "Ctrl+Shift+.",
      code: "Period",
      shift: true,
      prefix: "^",
      suffix: "^",
      placeholder: t("editor.placeholder.superscript")
    },
    {
      id: "subscript",
      label: t("editor.action.subscript"),
      button: "X₂",
      shortcut: "Ctrl+Shift+,",
      code: "Comma",
      shift: true,
      prefix: "~",
      suffix: "~",
      placeholder: t("editor.placeholder.subscript")
    },
    {
      id: "github-alert",
      label: t("editor.action.alert"),
      button: "Alert",
      shortcut: "Ctrl+Shift+A",
      key: "a",
      shift: true,
      format: "alert",
      placeholder: t("editor.placeholder.alert")
    },
    {
      id: "heading",
      label: t("editor.action.heading"),
      button: "H1",
      shortcut: "",
      format: "heading",
      placeholder: t("editor.placeholder.heading")
    },
    {
      id: "blockquote",
      label: t("editor.action.blockquote"),
      button: "Quote",
      shortcut: "",
      format: "blockquote",
      placeholder: t("editor.placeholder.quote")
    },
    {
      id: "unordered-list",
      label: t("editor.action.unordered_list"),
      button: "• List",
      shortcut: "",
      format: "unordered-list",
      placeholder: t("editor.placeholder.list_item")
    },
    {
      id: "ordered-list",
      label: t("editor.action.ordered_list"),
      button: "1. List",
      shortcut: "",
      format: "ordered-list",
      placeholder: t("editor.placeholder.list_item")
    },
    {
      id: "code-block",
      label: t("editor.action.code_block"),
      button: "```",
      shortcut: "",
      format: "code-block",
      placeholder: t("editor.placeholder.code")
    },
    {
      id: "image",
      label: t("editor.action.image"),
      button: "Image",
      shortcut: "",
      format: "image",
      placeholder: t("editor.placeholder.image_alt")
    },
    {
      id: "table",
      label: t("editor.action.table"),
      button: "Table",
      shortcut: "",
      format: "table",
      placeholder: t("editor.placeholder.content")
    }
  ];

  function formatMarkdownAction(action, selection = "") {
    const selected = String(selection || "");
    const content = selected || action?.placeholder || "";
    if (action?.format === "alert") {
      const alert = /^(?:>|&gt;) \[!NOTE\]\n([\s\S]*?)\n?$/.exec(selected);
      if (alert) {
        return alert[1]
          .split(/\r?\n/)
          .map((line) => line.replace(/^(?:>|&gt;) ?/, ""))
          .join("\n");
      }
      const quoted = content
        .split(/\r?\n/)
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return `> [!NOTE]\n${quoted}\n`;
    }
    if (action?.format === "heading") {
      return /^#{1,6}\s+/.test(selected) ? selected.replace(/^#{1,6}\s+/, "") : `# ${content}`;
    }
    if (action?.format === "blockquote") {
      const lines = content.split(/\r?\n/);
      const quoted = selected && lines.every((line) => !line || /^(?:>|&gt;) ?/.test(line));
      return quoted
        ? lines.map((line) => line.replace(/^(?:>|&gt;) ?/, "")).join("\n")
        : `${lines.map((line) => `> ${line}`).join("\n")}\n`;
    }
    if (action?.format === "unordered-list") {
      const lines = content.split(/\r?\n/);
      const listed = selected && lines.every((line) => !line || /^[-*+]\s+/.test(line));
      return listed
        ? lines.map((line) => line.replace(/^[-*+]\s+/, "")).join("\n")
        : `${lines.map((line) => `- ${line}`).join("\n")}\n`;
    }
    if (action?.format === "ordered-list") {
      const lines = content.split(/\r?\n/);
      const listed = selected && lines.every((line) => !line || /^\d+[.)]\s+/.test(line));
      return listed
        ? lines.map((line) => line.replace(/^\d+[.)]\s+/, "")).join("\n")
        : `${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}\n`;
    }
    if (action?.format === "code-block") {
      const fenced = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(selected);
      return fenced ? fenced[1] : `\`\`\`\n${content}\n\`\`\`\n`;
    }
    if (action?.format === "image") {
      const image = /^!\[([\s\S]*)\]\(url\)$/.exec(selected);
      return image ? image[1] : `![${content}](url)`;
    }
    if (action?.format === "table") {
      return t("editor.table.template", { content });
    }
    if (
      selected &&
      action?.prefix &&
      action?.suffix &&
      selected.startsWith(action.prefix) &&
      selected.endsWith(action.suffix) &&
      selected.length >= action.prefix.length + action.suffix.length
    ) {
      return selected.slice(action.prefix.length, selected.length - action.suffix.length);
    }
    return `${action?.prefix || ""}${content}${action?.suffix || ""}`;
  }

  function diagnostic(severity, message, line, column = 1) {
    return { severity, message, line, column };
  }

  function createLineLocator(source) {
    const text = String(source || "");
    const lineByOffset = new Uint32Array(text.length + 1);
    const lineStarts = [0];
    let lineIndex = 0;

    for (let index = 0; index < text.length; index++) {
      lineByOffset[index] = lineIndex;
      if (text.charCodeAt(index) === 10) {
        lineIndex++;
        lineStarts.push(index + 1);
      }
    }
    lineByOffset[text.length] = lineIndex;

    return (index) => {
      const numeric = Number.isFinite(index) ? Math.trunc(index) : 0;
      const offset = Math.max(0, Math.min(text.length, numeric));
      const locatedLine = lineByOffset[offset];
      return {
        line: locatedLine + 1,
        column: offset - lineStarts[locatedLine] + 1
      };
    };
  }

  function maskFencedCode(source) {
    return maskMarkdownFencedCode(source);
  }

  function maskSafeLinkInteractiveLabels(source, protectedSource) {
    const text = String(source || "");
    const masked = String(protectedSource || "");
    if (text.length !== masked.length) return masked;

    const output = masked.split("");
    const brackets = [];
    const interactivePatterns = [
      /\{\{[\s\S]*?\}\}/g,
      /\[\[[\s\S]*?\]\]/g,
      /\[(.*?)\]\^\((.*?)\)\^/gs
    ];

    function escapedAt(index) {
      let slashes = 0;
      while (index > 0 && text[--index] === "\\") slashes++;
      return slashes % 2 === 1;
    }

    function maskLabelRange(start, end) {
      const label = masked.slice(start, end);
      for (const pattern of interactivePatterns) {
        pattern.lastIndex = 0;
        for (const match of label.matchAll(pattern)) {
          const matchStart = start + match.index;
          const matchEnd = matchStart + match[0].length;
          for (let index = matchStart; index < matchEnd; index++) {
            if (output[index] !== "\r" && output[index] !== "\n") {
              output[index] = "x";
            }
          }
        }
      }
    }

    // Reference definitions are Markdown metadata and never become visible
    // field content. Keep Quizify-looking text in their labels, destinations,
    // and titles out of diagnostics/previews just like the renderer does.
    const referenceDefinition = /^ {0,3}\[((?:\\[\s\S]|[^\[\]\\])+?)\]:[ \t]*(?:<[^>\r\n]*>|[^\s<>]+)(?:[ \t]+(?:"(?:\\.|[^"\\\r\n])*"|'[^'\r\n]*'|\([^()\r\n]*\)))?[ \t]*(?=\r?$)/gm;
    for (const match of text.matchAll(referenceDefinition)) {
      const start = match.index;
      const end = start + match[0].length;
      for (let index = start; index < end; index++) {
        if (output[index] !== "\r" && output[index] !== "\n") {
          output[index] = "x";
        }
      }
    }

    for (let index = 0; index < text.length; index++) {
      if (text[index] === "\\") {
        index++;
        continue;
      }
      if (text[index] === "[") {
        brackets.push(index);
        continue;
      }
      if (text[index] !== "]" || !brackets.length) continue;

      const labelOpen = brackets.pop();
      if (
        masked[labelOpen] === text[labelOpen] ||
        masked[index] === text[index]
      ) {
        // The shared Markdown ownership pass masks these boundaries only for
        // a real link. Malformed link-looking text must remain diagnosable.
        continue;
      }
      if (
        (labelOpen > 0 &&
          text[labelOpen - 1] === "!" &&
          !escapedAt(labelOpen - 1)) ||
        (text.slice(Math.max(0, labelOpen - 6), labelOpen) === "!audio" &&
          !escapedAt(labelOpen - 6))
      ) {
        continue;
      }

      // The review renderer makes only interactive Quizify controls literal
      // inside an <a>. Preserve math, code and other inline ownership already
      // decided by maskMarkdownInlineContexts instead of hiding the whole label.
      maskLabelRange(labelOpen + 1, index);
    }

    return output.join("");
  }

  function protectAuthoringSyntax(source) {
    const fenced = maskFencedCode(source);
    const inline = maskMarkdownInlineContexts(fenced);
    return maskSafeLinkInteractiveLabels(fenced, inline);
  }

  function choiceOptionsFromLines(lines) {
    const options = [];
    const seen = new Set();

    for (const optionLine of lines) {
      const match = /^([A-Za-z])\. ?(.+)$/.exec(optionLine.text.trim());
      if (!match) continue;

      const letter = match[1].toUpperCase();
      options.push({
        letter,
        text: match[2],
        line: optionLine.line,
        duplicate: seen.has(letter)
      });
      seen.add(letter);
    }

    return options;
  }

  function analyzeFillBlanks(source, diagnostics, locate) {
    for (const match of source.matchAll(/\{\{(.*?)\}\}/gs)) {
      if (match[1].trim()) continue;
      const pos = locate(match.index);
      diagnostics.push(diagnostic("warning", t("syntax.empty_fitb"), pos.line, pos.column));
    }
  }

  function analyzeReveal(source, diagnostics, locate) {
    for (const match of source.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
      const body = match[1];
      const pos = locate(match.index);

      if (!body.includes("||")) {
        diagnostics.push(diagnostic("error", t("syntax.reveal_missing_separator"), pos.line, pos.column));
        continue;
      }

      const [question, answer] = body.split("||");
      if (!question.trim()) {
        diagnostics.push(diagnostic("warning", t("syntax.empty_reveal_question"), pos.line, pos.column));
      }
      if (!answer.trim()) {
        diagnostics.push(diagnostic("warning", t("syntax.empty_reveal_answer"), pos.line, pos.column));
      }
    }
  }

  function analyzeAnnotations(source, diagnostics, locate) {
    for (const match of source.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
      const pos = locate(match.index);
      if (!match[1].trim()) {
        diagnostics.push(diagnostic("warning", t("syntax.empty_annotation_text"), pos.line, pos.column));
      }
      if (!match[2].trim()) {
        diagnostics.push(diagnostic("warning", t("syntax.empty_annotation_note"), pos.line, pos.column));
      }
    }
  }

  function analyzeAudio(source, diagnostics, locate) {
    for (const match of source.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
      const pos = locate(match.index);
      if (!match[1].trim()) {
        diagnostics.push(diagnostic("warning", t("syntax.empty_audio_title"), pos.line, pos.column));
      }
      if (!match[2].trim()) {
        diagnostics.push(diagnostic("error", t("syntax.empty_audio_url"), pos.line, pos.column));
      }
    }
  }

  function analyzeChoiceBlocks(lines, diagnostics) {
    let index = 0;

    while (index < lines.length) {
      if (!/^;;;\s*$/.test(lines[index])) {
        index++;
        continue;
      }

      const startLine = index + 1;
      const optionLines = [];
      index++;

      while (
        index < lines.length &&
        !/^;;;[A-Za-z]*\s*$/.test(lines[index].trim())
      ) {
        optionLines.push({ text: lines[index], line: index + 1 });
        index++;
      }

      if (index >= lines.length) {
        diagnostics.push(diagnostic("error", t("syntax.choice_missing_answer_line"), startLine));
        return;
      }

      const close = /^;;;([A-Za-z]*)\s*$/.exec(lines[index].trim());
      const rawAnswers = close ? close[1].toUpperCase() : "";
      const answers = uniqueSortedLetters(rawAnswers).split("").filter(Boolean);
      const options = choiceOptionsFromLines(optionLines);
      const seen = new Set(options.map((option) => option.letter));

      if (options.length < 2) {
        diagnostics.push(diagnostic("error", t("syntax.choice_too_few_options"), startLine));
      }
      if (!answers.length) {
        diagnostics.push(diagnostic("error", t("syntax.choice_empty_answer"), index + 1));
      }
      if (rawAnswers && rawAnswers.length !== uniqueSortedLetters(rawAnswers).length) {
        diagnostics.push(diagnostic("warning", t("syntax.choice_duplicate_answers"), index + 1));
      }

      for (const answer of answers) {
        if (!seen.has(answer)) {
          diagnostics.push(diagnostic("error", t("syntax.choice_missing_option", { answer }), index + 1));
        }
      }

      for (const option of options) {
        if (option.duplicate) {
          diagnostics.push(diagnostic("error", t("syntax.choice_duplicate_option", { option: option.letter }), option.line));
        }
        if (!option.text.trim()) {
          diagnostics.push(diagnostic("warning", t("syntax.choice_empty_option", { option: option.letter }), option.line));
        }
      }

      index++;
    }
  }

  function analyzeContainers(lines, diagnostics) {
    const collapseStack = [];
    let tabStart = null;
    let tabCount = 0;

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const trimmed = line.trim();

      if (/^:::\s+\S/.test(trimmed)) {
        collapseStack.push(lineNo);
      } else if (/^:::\s*$/.test(trimmed)) {
        if (!collapseStack.length) {
          diagnostics.push(diagnostic("error", t("syntax.collapse_extra_close"), lineNo));
        } else {
          collapseStack.pop();
        }
      }

      if (/^===\s+\S/.test(trimmed)) {
        if (tabStart === null) tabStart = lineNo;
        tabCount++;
      } else if (/^===\s*$/.test(trimmed)) {
        if (tabStart === null) {
          diagnostics.push(diagnostic("error", t("syntax.tabs_extra_close"), lineNo));
        } else if (tabCount < 2) {
          diagnostics.push(diagnostic("warning", t("syntax.tabs_too_few"), tabStart));
          tabStart = null;
          tabCount = 0;
        } else {
          tabStart = null;
          tabCount = 0;
        }
      }
    });

    for (const lineNo of collapseStack) {
      diagnostics.push(diagnostic("error", t("syntax.collapse_missing_close"), lineNo));
    }

    if (tabStart !== null) {
      diagnostics.push(diagnostic("error", t("syntax.tabs_missing_close"), tabStart));
    }
  }

  function analyzeReciteBlocks(lines, diagnostics) {
    const stack = [];

    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const trimmed = line.trim();
      const opener = /^::::\s+recite(?:\s+(.*?))?\s*$/i.exec(trimmed);
      if (opener) {
        const entry = { line: lineNo, markers: 0 };
        const seen = new Set();
        String(opener[1] || "").split(/\s+/).filter(Boolean).forEach((part) => {
          const option = /^([A-Za-z][\w-]*)=(\S+)$/.exec(part);
          if (!option) {
            diagnostics.push(diagnostic("warning", t("syntax.recite_invalid_option", { option: part }), lineNo));
            return;
          }
          const key = option[1].toLowerCase();
          const value = option[2].toLowerCase();
          if (seen.has(key)) {
            diagnostics.push(diagnostic("warning", t("syntax.recite_duplicate_option", { option: key }), lineNo));
          }
          seen.add(key);
          if (key === "mask" && (!/^\d{1,3}$/.test(value) || Number(value) > 100)) {
            diagnostics.push(diagnostic("error", t("syntax.recite_invalid_mask"), lineNo));
          } else if (key === "mode" && !["auto", "manual", "mixed"].includes(value)) {
            diagnostics.push(diagnostic("error", t("syntax.recite_invalid_mode"), lineNo));
          } else if (!["mask", "mode"].includes(key)) {
            diagnostics.push(diagnostic("warning", t("syntax.recite_unknown_option", { option: key }), lineNo));
          }
        });
        stack.push(entry);
        return;
      }

      if (/^::::\s*$/.test(trimmed)) {
        if (!stack.length) {
          diagnostics.push(diagnostic("error", t("syntax.recite_extra_close"), lineNo));
          return;
        }
        const entry = stack.pop();
        if (entry.markers % 2 !== 0) {
          diagnostics.push(diagnostic("error", t("syntax.recite_unpaired_group"), entry.line));
        }
        return;
      }

      if (stack.length) {
        const count = (line.match(/%%/g) || []).length;
        stack[stack.length - 1].markers += count;
      }
    });

    stack.forEach((entry) => {
      diagnostics.push(diagnostic("error", t("syntax.recite_missing_close"), entry.line));
    });
  }

  function analyzeQuizifySyntax(source) {
    const text = String(source || "");
    const protectedText = protectAuthoringSyntax(text);
    const locate = createLineLocator(text);
    const diagnostics = [];
    const lines = protectedText.split(/\r?\n/);

    analyzeFillBlanks(protectedText, diagnostics, locate);
    analyzeReveal(protectedText, diagnostics, locate);
    analyzeAnnotations(protectedText, diagnostics, locate);
    analyzeAudio(protectedText, diagnostics, locate);
    analyzeChoiceBlocks(lines, diagnostics);
    analyzeContainers(lines, diagnostics);
    analyzeReciteBlocks(lines, diagnostics);

    diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
    return diagnostics;
  }

  function trimPreview(value, max = 40) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  function previewItem(kind, title, line, meta = {}, column = 1) {
    return { kind, title, line, meta, _sourceColumn: column };
  }

  function collectInlinePreview(source, items, locate) {
    const text = String(source || "");

    for (const match of text.matchAll(/\{\{(.*?)\}\}/gs)) {
      const pos = locate(match.index);
      const answer = trimPreview(match[1] || t("syntax.preview.empty_answer"));
      items.push(previewItem("fitb", t("editor.snippet.fitb"), pos.line, { answer }, pos.column));
    }

    for (const match of text.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
      const pos = locate(match.index);
      const [question = "", answer = ""] = match[1].split("||");
      items.push(previewItem("reveal", t("editor.snippet.reveal"), pos.line, {
        question: trimPreview(question || t("syntax.preview.empty_question")),
        answer: trimPreview(answer || t("syntax.preview.empty_answer"))
      }, pos.column));
    }

    for (const match of text.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
      const pos = locate(match.index);
      items.push(previewItem("annotation", t("editor.snippet.annotation"), pos.line, {
        text: trimPreview(match[1] || t("syntax.preview.empty_text")),
        note: trimPreview(match[2] || t("syntax.preview.empty_note"))
      }, pos.column));
    }

    for (const match of text.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
      const pos = locate(match.index);
      items.push(previewItem("audio", t("editor.snippet.audio"), pos.line, {
        title: trimPreview(match[1] || t("syntax.preview.untitled")),
        url: trimPreview(match[2] || t("syntax.preview.no_file"))
      }, pos.column));
    }
  }

  function collectChoicePreview(lines, items) {
    let index = 0;

    while (index < lines.length) {
      if (!/^;;;\s*$/.test(lines[index])) {
        index++;
        continue;
      }

      const startLine = index + 1;
      const optionLines = [];
      index++;

      while (
        index < lines.length &&
        !/^;;;[A-Za-z]*\s*$/.test(lines[index].trim())
      ) {
        optionLines.push({ text: lines[index], line: index + 1 });
        index++;
      }

      const close = index < lines.length ? /^;;;([A-Za-z]*)\s*$/.exec(lines[index].trim()) : null;
      const options = choiceOptionsFromLines(optionLines).map((option) => option.letter);
      const answers = close ? uniqueSortedLetters(close[1]) : "";

      items.push(previewItem(answers.length === 1 ? "single" : "multiple", t(answers.length === 1 ? "syntax.preview.single" : "syntax.preview.multiple"), startLine, {
        options: options.join("") || t("syntax.preview.no_options"),
        answers: answers || t("syntax.preview.no_answer")
      }));

      index++;
    }
  }

  function collectContainerPreview(lines, items) {
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const collapse = /^:::\s+(.+?)\s*$/.exec(line.trim());
      if (collapse) {
        items.push(previewItem("collapse", t("editor.snippet.collapse"), lineNo, {
          title: trimPreview(collapse[1])
        }));
      }

      const recite = /^::::\s+recite(?:\s+(.*?))?\s*$/i.exec(line.trim());
      if (recite) {
        const options = Object.fromEntries(
          String(recite[1] || "")
            .split(/\s+/)
            .map((part) => part.split("=", 2))
            .filter((pair) => pair.length === 2)
        );
        items.push(previewItem("recite", t("editor.snippet.recite"), lineNo, {
          mask: options.mask || "40",
          mode: options.mode || "mixed"
        }));
      }

      const tab = /^===\s+(.+?)\s*$/.exec(line.trim());
      if (tab) {
        items.push(previewItem("tab", t("editor.snippet.tabs"), lineNo, {
          title: trimPreview(tab[1])
        }));
      }
    });
  }

  function collectQuizifyPreview(source) {
    const text = String(source || "");
    const protectedText = protectAuthoringSyntax(text);
    const lines = protectedText.split(/\r?\n/);
    const locate = createLineLocator(text);
    const items = [];

    collectInlinePreview(protectedText, items, locate);
    collectChoicePreview(lines, items);
    collectContainerPreview(lines, items);

    items.sort((a, b) => a.line - b.line || a._sourceColumn - b._sourceColumn);
    return items.map(({ _sourceColumn, ...item }) => item);
  }

  function summarizeDiagnostics(diagnostics) {
    const errors = diagnostics.filter((item) => item.severity === "error").length;
    const warnings = diagnostics.filter((item) => item.severity === "warning").length;

    if (!errors && !warnings) return t("syntax.summary.valid");
    const errorSummary = tn("syntax.summary.errors", errors);
    const warningSummary = tn("syntax.summary.warnings", warnings);
    if (errors && warnings) {
      return t("syntax.summary.combined", {
        errors: errorSummary,
        warnings: warningSummary
      });
    }
    return errors ? errorSummary : warningSummary;
  }

  return {
    snippets,
    markdownActions,
    formatMarkdownAction,
    analyzeQuizifySyntax,
    collectQuizifyPreview,
    summarizeDiagnostics
  };
});
