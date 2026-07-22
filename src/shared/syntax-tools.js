/* Shared Quizify authoring syntax analyzer. */
import {
  uniqueSortedLetters
} from "./markdown-structure.js";
import {
  maskMarkdownFencedCode,
  maskMarkdownInlineContexts
} from "./math.js";
(function (root, factory) {
  const api = factory();

  if (root) {
    root.QuizifySyntax = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const snippets = [
    ["填空", "{{答案}}"],
    ["选择", ";;;\nA. 选项 A\nB. 选项 B\nC. 选项 C\n;;;A\n"],
    ["揭示", "[[题干||答案]]"],
    ["批注", "[内容]^(批注)^"],
    ["折叠", "::: 标题\n内容\n:::\n"],
    ["标签页", "=== 标签一\n内容一\n=== 标签二\n内容二\n===\n"],
    ["音频", "!audio[标题](文件名.mp3)"],
    ["背诵", ":::: recite mask=40 mode=mixed\n需要背诵的内容，%%这个短语%%会作为一个整体。\n::::\n"]
  ];

  const markdownActions = [
    {
      id: "bold",
      label: "加粗",
      button: "B",
      shortcut: "Ctrl+B",
      key: "b",
      prefix: "**",
      suffix: "**",
      placeholder: "粗体"
    },
    {
      id: "italic",
      label: "斜体",
      button: "I",
      shortcut: "Ctrl+I",
      key: "i",
      prefix: "*",
      suffix: "*",
      placeholder: "斜体"
    },
    {
      id: "inline-code",
      label: "行内代码",
      button: "</>",
      shortcut: "Ctrl+`",
      key: "`",
      prefix: "`",
      suffix: "`",
      placeholder: "代码"
    },
    {
      id: "link",
      label: "链接",
      button: "Link",
      shortcut: "Ctrl+K",
      key: "k",
      prefix: "[",
      suffix: "](url)",
      placeholder: "链接文字"
    },
    {
      id: "strikethrough",
      label: "删除线",
      button: "S",
      shortcut: "Ctrl+Shift+X",
      key: "x",
      shift: true,
      prefix: "~~",
      suffix: "~~",
      placeholder: "删除线"
    },
    {
      id: "highlight",
      label: "高亮",
      button: "==",
      shortcut: "Ctrl+Shift+H",
      key: "h",
      shift: true,
      prefix: "==",
      suffix: "==",
      placeholder: "高亮"
    },
    {
      id: "superscript",
      label: "上标",
      button: "X²",
      shortcut: "Ctrl+Shift+.",
      code: "Period",
      shift: true,
      prefix: "^",
      suffix: "^",
      placeholder: "上标"
    },
    {
      id: "subscript",
      label: "下标",
      button: "X₂",
      shortcut: "Ctrl+Shift+,",
      code: "Comma",
      shift: true,
      prefix: "~",
      suffix: "~",
      placeholder: "下标"
    },
    {
      id: "github-alert",
      label: "警告框",
      button: "Alert",
      shortcut: "Ctrl+Shift+A",
      key: "a",
      shift: true,
      format: "alert",
      placeholder: "提示内容"
    },
    {
      id: "heading",
      label: "标题",
      button: "H1",
      shortcut: "",
      format: "heading",
      placeholder: "标题"
    },
    {
      id: "blockquote",
      label: "引用",
      button: "Quote",
      shortcut: "",
      format: "blockquote",
      placeholder: "引用内容"
    },
    {
      id: "unordered-list",
      label: "无序列表",
      button: "• List",
      shortcut: "",
      format: "unordered-list",
      placeholder: "列表项"
    },
    {
      id: "ordered-list",
      label: "有序列表",
      button: "1. List",
      shortcut: "",
      format: "ordered-list",
      placeholder: "列表项"
    },
    {
      id: "code-block",
      label: "代码块",
      button: "```",
      shortcut: "",
      format: "code-block",
      placeholder: "代码"
    },
    {
      id: "image",
      label: "图片",
      button: "Image",
      shortcut: "",
      format: "image",
      placeholder: "图片说明"
    },
    {
      id: "table",
      label: "表格",
      button: "Table",
      shortcut: "",
      format: "table",
      placeholder: "内容"
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
      return `| 列 1 | 列 2 |\n| --- | --- |\n| ${content} | 内容 |\n`;
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
      diagnostics.push(diagnostic("warning", "填空题答案为空。", pos.line, pos.column));
    }
  }

  function analyzeReveal(source, diagnostics, locate) {
    for (const match of source.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
      const body = match[1];
      const pos = locate(match.index);

      if (!body.includes("||")) {
        diagnostics.push(diagnostic("error", "揭示语法缺少 || 分隔符。", pos.line, pos.column));
        continue;
      }

      const [question, answer] = body.split("||");
      if (!question.trim()) {
        diagnostics.push(diagnostic("warning", "揭示题干为空。", pos.line, pos.column));
      }
      if (!answer.trim()) {
        diagnostics.push(diagnostic("warning", "揭示答案为空。", pos.line, pos.column));
      }
    }
  }

  function analyzeAnnotations(source, diagnostics, locate) {
    for (const match of source.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
      const pos = locate(match.index);
      if (!match[1].trim()) {
        diagnostics.push(diagnostic("warning", "批注正文为空。", pos.line, pos.column));
      }
      if (!match[2].trim()) {
        diagnostics.push(diagnostic("warning", "批注内容为空。", pos.line, pos.column));
      }
    }
  }

  function analyzeAudio(source, diagnostics, locate) {
    for (const match of source.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
      const pos = locate(match.index);
      if (!match[1].trim()) {
        diagnostics.push(diagnostic("warning", "音频标题为空。", pos.line, pos.column));
      }
      if (!match[2].trim()) {
        diagnostics.push(diagnostic("error", "音频文件地址为空。", pos.line, pos.column));
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
        diagnostics.push(diagnostic("error", "选择题缺少结尾答案行，例如 ;;;A。", startLine));
        return;
      }

      const close = /^;;;([A-Za-z]*)\s*$/.exec(lines[index].trim());
      const rawAnswers = close ? close[1].toUpperCase() : "";
      const answers = uniqueSortedLetters(rawAnswers).split("").filter(Boolean);
      const options = choiceOptionsFromLines(optionLines);
      const seen = new Set(options.map((option) => option.letter));

      if (options.length < 2) {
        diagnostics.push(diagnostic("error", "选择题至少需要两个选项。", startLine));
      }
      if (!answers.length) {
        diagnostics.push(diagnostic("error", "选择题答案为空。", index + 1));
      }
      if (rawAnswers && rawAnswers.length !== uniqueSortedLetters(rawAnswers).length) {
        diagnostics.push(diagnostic("warning", "选择题答案包含重复字母，复习时会按唯一答案处理。", index + 1));
      }

      for (const answer of answers) {
        if (!seen.has(answer)) {
          diagnostics.push(diagnostic("error", `选择题答案 ${answer} 没有对应选项。`, index + 1));
        }
      }

      for (const option of options) {
        if (option.duplicate) {
          diagnostics.push(diagnostic("error", `选择题选项 ${option.letter} 重复。`, option.line));
        }
        if (!option.text.trim()) {
          diagnostics.push(diagnostic("warning", `选项 ${option.letter} 内容为空。`, option.line));
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
          diagnostics.push(diagnostic("error", "折叠块出现了多余的结束标记 :::。", lineNo));
        } else {
          collapseStack.pop();
        }
      }

      if (/^===\s+\S/.test(trimmed)) {
        if (tabStart === null) tabStart = lineNo;
        tabCount++;
      } else if (/^===\s*$/.test(trimmed)) {
        if (tabStart === null) {
          diagnostics.push(diagnostic("error", "标签页出现了多余的结束标记 ===。", lineNo));
        } else if (tabCount < 2) {
          diagnostics.push(diagnostic("warning", "标签页通常至少需要两个标签。", tabStart));
          tabStart = null;
          tabCount = 0;
        } else {
          tabStart = null;
          tabCount = 0;
        }
      }
    });

    for (const lineNo of collapseStack) {
      diagnostics.push(diagnostic("error", "折叠块缺少结束标记 :::。", lineNo));
    }

    if (tabStart !== null) {
      diagnostics.push(diagnostic("error", "标签页缺少结束标记 ===。", tabStart));
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
            diagnostics.push(diagnostic("warning", `背诵参数格式无效：${part}。`, lineNo));
            return;
          }
          const key = option[1].toLowerCase();
          const value = option[2].toLowerCase();
          if (seen.has(key)) {
            diagnostics.push(diagnostic("warning", `背诵参数 ${key} 重复。`, lineNo));
          }
          seen.add(key);
          if (key === "mask" && (!/^\d{1,3}$/.test(value) || Number(value) > 100)) {
            diagnostics.push(diagnostic("error", "背诵遮挡比例 mask 必须是 0 到 100。", lineNo));
          } else if (key === "mode" && !["auto", "manual", "mixed"].includes(value)) {
            diagnostics.push(diagnostic("error", "背诵 mode 只能是 auto、manual 或 mixed。", lineNo));
          } else if (!["mask", "mode"].includes(key)) {
            diagnostics.push(diagnostic("warning", `未知背诵参数：${key}。`, lineNo));
          }
        });
        stack.push(entry);
        return;
      }

      if (/^::::\s*$/.test(trimmed)) {
        if (!stack.length) {
          diagnostics.push(diagnostic("error", "背诵块出现了多余的结束标记 ::::。", lineNo));
          return;
        }
        const entry = stack.pop();
        if (entry.markers % 2 !== 0) {
          diagnostics.push(diagnostic("error", "背诵分组缺少配对的 %% 标记。", entry.line));
        }
        return;
      }

      if (stack.length) {
        const count = (line.match(/%%/g) || []).length;
        stack[stack.length - 1].markers += count;
      }
    });

    stack.forEach((entry) => {
      diagnostics.push(diagnostic("error", "背诵块缺少结束标记 ::::。", entry.line));
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

  function previewItem(kind, title, line, meta = {}) {
    return { kind, title, line, meta };
  }

  function collectInlinePreview(source, items, locate) {
    const text = String(source || "");

    for (const match of text.matchAll(/\{\{(.*?)\}\}/gs)) {
      const pos = locate(match.index);
      const answer = trimPreview(match[1] || "空答案");
      items.push(previewItem("fitb", "填空", pos.line, { answer }));
    }

    for (const match of text.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
      const pos = locate(match.index);
      const [question = "", answer = ""] = match[1].split("||");
      items.push(previewItem("reveal", "揭示", pos.line, {
        question: trimPreview(question || "空题干"),
        answer: trimPreview(answer || "空答案")
      }));
    }

    for (const match of text.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
      const pos = locate(match.index);
      items.push(previewItem("annotation", "批注", pos.line, {
        text: trimPreview(match[1] || "空正文"),
        note: trimPreview(match[2] || "空批注")
      }));
    }

    for (const match of text.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
      const pos = locate(match.index);
      items.push(previewItem("audio", "音频", pos.line, {
        title: trimPreview(match[1] || "无标题"),
        url: trimPreview(match[2] || "无文件")
      }));
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

      items.push(previewItem(answers.length === 1 ? "single" : "multiple", answers.length === 1 ? "单选" : "多选", startLine, {
        options: options.join("") || "无选项",
        answers: answers || "无答案"
      }));

      index++;
    }
  }

  function collectContainerPreview(lines, items) {
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      const collapse = /^:::\s+(.+?)\s*$/.exec(line.trim());
      if (collapse) {
        items.push(previewItem("collapse", "折叠", lineNo, {
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
        items.push(previewItem("recite", "背诵", lineNo, {
          mask: options.mask || "40",
          mode: options.mode || "mixed"
        }));
      }

      const tab = /^===\s+(.+?)\s*$/.exec(line.trim());
      if (tab) {
        items.push(previewItem("tab", "标签页", lineNo, {
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

    items.sort((a, b) => a.line - b.line || a.title.localeCompare(b.title));
    return items;
  }

  function summarizeDiagnostics(diagnostics) {
    const errors = diagnostics.filter((item) => item.severity === "error").length;
    const warnings = diagnostics.filter((item) => item.severity === "warning").length;

    if (!errors && !warnings) return "语法通过";
    if (errors && warnings) return `${errors} 个错误，${warnings} 个警告`;
    if (errors) return `${errors} 个错误`;
    return `${warnings} 个警告`;
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
