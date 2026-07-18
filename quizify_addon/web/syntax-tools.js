(() => {
  // src/shared/markdown-structure.js
  function fenceMarker(line) {
    const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(String(line != null ? line : ""));
    return match ? { char: match[1][0], length: match[1].length } : null;
  }
  function closesFence(line, fence) {
    if (!fence) return false;
    const match = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(String(line != null ? line : ""));
    return Boolean(
      match && match[1][0] === fence.char && match[1].length >= fence.length
    );
  }
  function nextFence(line, fence) {
    if (fence) return closesFence(line, fence) ? null : fence;
    return fenceMarker(line);
  }
  function uniqueSortedLetters(value) {
    return Array.from(new Set(String(value || "").toUpperCase().split(""))).filter((letter) => /^[A-Z]$/.test(letter)).sort().join("");
  }

  // src/shared/syntax-tools.js
  (function(root, factory) {
    const api = factory();
    if (root) {
      root.QuizifySyntax = api;
    }
  })(typeof globalThis !== "undefined" ? globalThis : window, function() {
    const snippets = [
      ["\u586B\u7A7A", "{{\u7B54\u6848}}"],
      ["\u9009\u62E9", ";;;\nA. \u9009\u9879 A\nB. \u9009\u9879 B\nC. \u9009\u9879 C\n;;;A\n"],
      ["\u63ED\u793A", "[[\u9898\u5E72||\u7B54\u6848]]"],
      ["\u6279\u6CE8", "[\u5185\u5BB9]^(\u6279\u6CE8)^"],
      ["\u6298\u53E0", "::: \u6807\u9898\n\u5185\u5BB9\n:::\n"],
      ["\u6807\u7B7E\u9875", "=== \u6807\u7B7E\u4E00\n\u5185\u5BB9\u4E00\n=== \u6807\u7B7E\u4E8C\n\u5185\u5BB9\u4E8C\n===\n"],
      ["\u97F3\u9891", "!audio[\u6807\u9898](\u6587\u4EF6\u540D.mp3)"],
      ["\u80CC\u8BF5", ":::: recite mask=40 mode=mixed\n\u9700\u8981\u80CC\u8BF5\u7684\u5185\u5BB9\uFF0C%%\u8FD9\u4E2A\u77ED\u8BED%%\u4F1A\u4F5C\u4E3A\u4E00\u4E2A\u6574\u4F53\u3002\n::::\n"]
    ];
    const markdownActions = [
      {
        id: "bold",
        label: "\u52A0\u7C97",
        button: "B",
        shortcut: "Ctrl+B",
        key: "b",
        prefix: "**",
        suffix: "**",
        placeholder: "\u7C97\u4F53"
      },
      {
        id: "italic",
        label: "\u659C\u4F53",
        button: "I",
        shortcut: "Ctrl+I",
        key: "i",
        prefix: "*",
        suffix: "*",
        placeholder: "\u659C\u4F53"
      },
      {
        id: "inline-code",
        label: "\u884C\u5185\u4EE3\u7801",
        button: "</>",
        shortcut: "Ctrl+`",
        key: "`",
        prefix: "`",
        suffix: "`",
        placeholder: "\u4EE3\u7801"
      },
      {
        id: "link",
        label: "\u94FE\u63A5",
        button: "Link",
        shortcut: "Ctrl+K",
        key: "k",
        prefix: "[",
        suffix: "](url)",
        placeholder: "\u94FE\u63A5\u6587\u5B57"
      },
      {
        id: "strikethrough",
        label: "\u5220\u9664\u7EBF",
        button: "S",
        shortcut: "Ctrl+Shift+X",
        key: "x",
        shift: true,
        prefix: "~~",
        suffix: "~~",
        placeholder: "\u5220\u9664\u7EBF"
      },
      {
        id: "highlight",
        label: "\u9AD8\u4EAE",
        button: "==",
        shortcut: "Ctrl+Shift+H",
        key: "h",
        shift: true,
        prefix: "==",
        suffix: "==",
        placeholder: "\u9AD8\u4EAE"
      },
      {
        id: "superscript",
        label: "\u4E0A\u6807",
        button: "X\xB2",
        shortcut: "Ctrl+Shift+.",
        code: "Period",
        shift: true,
        prefix: "^",
        suffix: "^",
        placeholder: "\u4E0A\u6807"
      },
      {
        id: "subscript",
        label: "\u4E0B\u6807",
        button: "X\u2082",
        shortcut: "Ctrl+Shift+,",
        code: "Comma",
        shift: true,
        prefix: "~",
        suffix: "~",
        placeholder: "\u4E0B\u6807"
      },
      {
        id: "github-alert",
        label: "\u8B66\u544A\u6846",
        button: "Alert",
        shortcut: "Ctrl+Shift+A",
        key: "a",
        shift: true,
        format: "alert",
        placeholder: "\u63D0\u793A\u5185\u5BB9"
      },
      {
        id: "heading",
        label: "\u6807\u9898",
        button: "H1",
        shortcut: "",
        format: "heading",
        placeholder: "\u6807\u9898"
      },
      {
        id: "blockquote",
        label: "\u5F15\u7528",
        button: "Quote",
        shortcut: "",
        format: "blockquote",
        placeholder: "\u5F15\u7528\u5185\u5BB9"
      },
      {
        id: "unordered-list",
        label: "\u65E0\u5E8F\u5217\u8868",
        button: "\u2022 List",
        shortcut: "",
        format: "unordered-list",
        placeholder: "\u5217\u8868\u9879"
      },
      {
        id: "ordered-list",
        label: "\u6709\u5E8F\u5217\u8868",
        button: "1. List",
        shortcut: "",
        format: "ordered-list",
        placeholder: "\u5217\u8868\u9879"
      },
      {
        id: "code-block",
        label: "\u4EE3\u7801\u5757",
        button: "```",
        shortcut: "",
        format: "code-block",
        placeholder: "\u4EE3\u7801"
      },
      {
        id: "image",
        label: "\u56FE\u7247",
        button: "Image",
        shortcut: "",
        format: "image",
        placeholder: "\u56FE\u7247\u8BF4\u660E"
      },
      {
        id: "table",
        label: "\u8868\u683C",
        button: "Table",
        shortcut: "",
        format: "table",
        placeholder: "\u5185\u5BB9"
      }
    ];
    function formatMarkdownAction(action, selection = "") {
      const selected = String(selection || "");
      const content = selected || (action == null ? void 0 : action.placeholder) || "";
      if ((action == null ? void 0 : action.format) === "alert") {
        const alert = /^(?:>|&gt;) \[!NOTE\]\n([\s\S]*?)\n?$/.exec(selected);
        if (alert) {
          return alert[1].split(/\r?\n/).map((line) => line.replace(/^(?:>|&gt;) ?/, "")).join("\n");
        }
        const quoted = content.split(/\r?\n/).map((line) => line ? `> ${line}` : ">").join("\n");
        return `> [!NOTE]
${quoted}
`;
      }
      if ((action == null ? void 0 : action.format) === "heading") {
        return /^#{1,6}\s+/.test(selected) ? selected.replace(/^#{1,6}\s+/, "") : `# ${content}`;
      }
      if ((action == null ? void 0 : action.format) === "blockquote") {
        const lines = content.split(/\r?\n/);
        const quoted = selected && lines.every((line) => !line || /^(?:>|&gt;) ?/.test(line));
        return quoted ? lines.map((line) => line.replace(/^(?:>|&gt;) ?/, "")).join("\n") : `${lines.map((line) => `> ${line}`).join("\n")}
`;
      }
      if ((action == null ? void 0 : action.format) === "unordered-list") {
        const lines = content.split(/\r?\n/);
        const listed = selected && lines.every((line) => !line || /^[-*+]\s+/.test(line));
        return listed ? lines.map((line) => line.replace(/^[-*+]\s+/, "")).join("\n") : `${lines.map((line) => `- ${line}`).join("\n")}
`;
      }
      if ((action == null ? void 0 : action.format) === "ordered-list") {
        const lines = content.split(/\r?\n/);
        const listed = selected && lines.every((line) => !line || /^\d+[.)]\s+/.test(line));
        return listed ? lines.map((line) => line.replace(/^\d+[.)]\s+/, "")).join("\n") : `${lines.map((line, index) => `${index + 1}. ${line}`).join("\n")}
`;
      }
      if ((action == null ? void 0 : action.format) === "code-block") {
        const fenced = /^```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(selected);
        return fenced ? fenced[1] : `\`\`\`
${content}
\`\`\`
`;
      }
      if ((action == null ? void 0 : action.format) === "image") {
        const image = /^!\[([\s\S]*)\]\(url\)$/.exec(selected);
        return image ? image[1] : `![${content}](url)`;
      }
      if ((action == null ? void 0 : action.format) === "table") {
        return `| \u5217 1 | \u5217 2 |
| --- | --- |
| ${content} | \u5185\u5BB9 |
`;
      }
      if (selected && (action == null ? void 0 : action.prefix) && (action == null ? void 0 : action.suffix) && selected.startsWith(action.prefix) && selected.endsWith(action.suffix) && selected.length >= action.prefix.length + action.suffix.length) {
        return selected.slice(action.prefix.length, selected.length - action.suffix.length);
      }
      return `${(action == null ? void 0 : action.prefix) || ""}${content}${(action == null ? void 0 : action.suffix) || ""}`;
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
      let fence = null;
      return String(source || "").split("\n").map((line) => {
        const wasFenced = Boolean(fence);
        const next = nextFence(line, fence);
        const isFenceBoundary = next !== fence;
        fence = next;
        return wasFenced || isFenceBoundary ? " ".repeat(line.length) : line;
      }).join("\n");
    }
    function choiceOptionsFromLines(lines) {
      const options = [];
      const seen = /* @__PURE__ */ new Set();
      let fence = null;
      for (const optionLine of lines) {
        const next = nextFence(optionLine.text, fence);
        if (fence || next) {
          fence = next;
          continue;
        }
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
        diagnostics.push(diagnostic("warning", "\u586B\u7A7A\u9898\u7B54\u6848\u4E3A\u7A7A\u3002", pos.line, pos.column));
      }
    }
    function analyzeReveal(source, diagnostics, locate) {
      for (const match of source.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
        const body = match[1];
        const pos = locate(match.index);
        if (!body.includes("||")) {
          diagnostics.push(diagnostic("error", "\u63ED\u793A\u8BED\u6CD5\u7F3A\u5C11 || \u5206\u9694\u7B26\u3002", pos.line, pos.column));
          continue;
        }
        const [question, answer] = body.split("||");
        if (!question.trim()) {
          diagnostics.push(diagnostic("warning", "\u63ED\u793A\u9898\u5E72\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
        if (!answer.trim()) {
          diagnostics.push(diagnostic("warning", "\u63ED\u793A\u7B54\u6848\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
      }
    }
    function analyzeAnnotations(source, diagnostics, locate) {
      for (const match of source.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
        const pos = locate(match.index);
        if (!match[1].trim()) {
          diagnostics.push(diagnostic("warning", "\u6279\u6CE8\u6B63\u6587\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
        if (!match[2].trim()) {
          diagnostics.push(diagnostic("warning", "\u6279\u6CE8\u5185\u5BB9\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
      }
    }
    function analyzeAudio(source, diagnostics, locate) {
      for (const match of source.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
        const pos = locate(match.index);
        if (!match[1].trim()) {
          diagnostics.push(diagnostic("warning", "\u97F3\u9891\u6807\u9898\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
        if (!match[2].trim()) {
          diagnostics.push(diagnostic("error", "\u97F3\u9891\u6587\u4EF6\u5730\u5740\u4E3A\u7A7A\u3002", pos.line, pos.column));
        }
      }
    }
    function analyzeChoiceBlocks(lines, diagnostics) {
      let index = 0;
      let fence = null;
      while (index < lines.length) {
        const next = nextFence(lines[index], fence);
        if (fence || next) {
          fence = next;
          index++;
          continue;
        }
        if (!/^;;;\s*$/.test(lines[index])) {
          index++;
          continue;
        }
        const startLine = index + 1;
        const optionLines = [];
        let blockFence = null;
        index++;
        while (index < lines.length && (blockFence || !/^;;;[A-Za-z]*\s*$/.test(lines[index].trim()))) {
          optionLines.push({ text: lines[index], line: index + 1 });
          blockFence = nextFence(lines[index], blockFence);
          index++;
        }
        if (index >= lines.length) {
          diagnostics.push(diagnostic("error", "\u9009\u62E9\u9898\u7F3A\u5C11\u7ED3\u5C3E\u7B54\u6848\u884C\uFF0C\u4F8B\u5982 ;;;A\u3002", startLine));
          return;
        }
        const close = /^;;;([A-Za-z]*)\s*$/.exec(lines[index].trim());
        const rawAnswers = close ? close[1].toUpperCase() : "";
        const answers = uniqueSortedLetters(rawAnswers).split("").filter(Boolean);
        const options = choiceOptionsFromLines(optionLines);
        const seen = new Set(options.map((option) => option.letter));
        if (options.length < 2) {
          diagnostics.push(diagnostic("error", "\u9009\u62E9\u9898\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u9009\u9879\u3002", startLine));
        }
        if (!answers.length) {
          diagnostics.push(diagnostic("error", "\u9009\u62E9\u9898\u7B54\u6848\u4E3A\u7A7A\u3002", index + 1));
        }
        if (rawAnswers && rawAnswers.length !== uniqueSortedLetters(rawAnswers).length) {
          diagnostics.push(diagnostic("warning", "\u9009\u62E9\u9898\u7B54\u6848\u5305\u542B\u91CD\u590D\u5B57\u6BCD\uFF0C\u590D\u4E60\u65F6\u4F1A\u6309\u552F\u4E00\u7B54\u6848\u5904\u7406\u3002", index + 1));
        }
        for (const answer of answers) {
          if (!seen.has(answer)) {
            diagnostics.push(diagnostic("error", `\u9009\u62E9\u9898\u7B54\u6848 ${answer} \u6CA1\u6709\u5BF9\u5E94\u9009\u9879\u3002`, index + 1));
          }
        }
        for (const option of options) {
          if (option.duplicate) {
            diagnostics.push(diagnostic("error", `\u9009\u62E9\u9898\u9009\u9879 ${option.letter} \u91CD\u590D\u3002`, option.line));
          }
          if (!option.text.trim()) {
            diagnostics.push(diagnostic("warning", `\u9009\u9879 ${option.letter} \u5185\u5BB9\u4E3A\u7A7A\u3002`, option.line));
          }
        }
        index++;
      }
    }
    function analyzeContainers(lines, diagnostics) {
      const collapseStack = [];
      let tabStart = null;
      let tabCount = 0;
      let fence = null;
      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        const trimmed = line.trim();
        const next = nextFence(line, fence);
        if (fence || next) {
          fence = next;
          return;
        }
        if (/^:::\s+\S/.test(trimmed)) {
          collapseStack.push(lineNo);
        } else if (/^:::\s*$/.test(trimmed)) {
          if (!collapseStack.length) {
            diagnostics.push(diagnostic("error", "\u6298\u53E0\u5757\u51FA\u73B0\u4E86\u591A\u4F59\u7684\u7ED3\u675F\u6807\u8BB0 :::\u3002", lineNo));
          } else {
            collapseStack.pop();
          }
        }
        if (/^===\s+\S/.test(trimmed)) {
          if (tabStart === null) tabStart = lineNo;
          tabCount++;
        } else if (/^===\s*$/.test(trimmed)) {
          if (tabStart === null) {
            diagnostics.push(diagnostic("error", "\u6807\u7B7E\u9875\u51FA\u73B0\u4E86\u591A\u4F59\u7684\u7ED3\u675F\u6807\u8BB0 ===\u3002", lineNo));
          } else if (tabCount < 2) {
            diagnostics.push(diagnostic("warning", "\u6807\u7B7E\u9875\u901A\u5E38\u81F3\u5C11\u9700\u8981\u4E24\u4E2A\u6807\u7B7E\u3002", tabStart));
            tabStart = null;
            tabCount = 0;
          } else {
            tabStart = null;
            tabCount = 0;
          }
        }
      });
      for (const lineNo of collapseStack) {
        diagnostics.push(diagnostic("error", "\u6298\u53E0\u5757\u7F3A\u5C11\u7ED3\u675F\u6807\u8BB0 :::\u3002", lineNo));
      }
      if (tabStart !== null) {
        diagnostics.push(diagnostic("error", "\u6807\u7B7E\u9875\u7F3A\u5C11\u7ED3\u675F\u6807\u8BB0 ===\u3002", tabStart));
      }
    }
    function analyzeReciteBlocks(lines, diagnostics) {
      const stack = [];
      let fence = null;
      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        const trimmed = line.trim();
        const next = nextFence(line, fence);
        if (fence || next) {
          fence = next;
          return;
        }
        const opener = /^::::\s+recite(?:\s+(.*?))?\s*$/i.exec(trimmed);
        if (opener) {
          const entry = { line: lineNo, markers: 0 };
          const seen = /* @__PURE__ */ new Set();
          String(opener[1] || "").split(/\s+/).filter(Boolean).forEach((part) => {
            const option = /^([A-Za-z][\w-]*)=(\S+)$/.exec(part);
            if (!option) {
              diagnostics.push(diagnostic("warning", `\u80CC\u8BF5\u53C2\u6570\u683C\u5F0F\u65E0\u6548\uFF1A${part}\u3002`, lineNo));
              return;
            }
            const key = option[1].toLowerCase();
            const value = option[2].toLowerCase();
            if (seen.has(key)) {
              diagnostics.push(diagnostic("warning", `\u80CC\u8BF5\u53C2\u6570 ${key} \u91CD\u590D\u3002`, lineNo));
            }
            seen.add(key);
            if (key === "mask" && (!/^\d{1,3}$/.test(value) || Number(value) > 100)) {
              diagnostics.push(diagnostic("error", "\u80CC\u8BF5\u906E\u6321\u6BD4\u4F8B mask \u5FC5\u987B\u662F 0 \u5230 100\u3002", lineNo));
            } else if (key === "mode" && !["auto", "manual", "mixed"].includes(value)) {
              diagnostics.push(diagnostic("error", "\u80CC\u8BF5 mode \u53EA\u80FD\u662F auto\u3001manual \u6216 mixed\u3002", lineNo));
            } else if (!["mask", "mode"].includes(key)) {
              diagnostics.push(diagnostic("warning", `\u672A\u77E5\u80CC\u8BF5\u53C2\u6570\uFF1A${key}\u3002`, lineNo));
            }
          });
          stack.push(entry);
          return;
        }
        if (/^::::\s*$/.test(trimmed)) {
          if (!stack.length) {
            diagnostics.push(diagnostic("error", "\u80CC\u8BF5\u5757\u51FA\u73B0\u4E86\u591A\u4F59\u7684\u7ED3\u675F\u6807\u8BB0 ::::\u3002", lineNo));
            return;
          }
          const entry = stack.pop();
          if (entry.markers % 2 !== 0) {
            diagnostics.push(diagnostic("error", "\u80CC\u8BF5\u5206\u7EC4\u7F3A\u5C11\u914D\u5BF9\u7684 %% \u6807\u8BB0\u3002", entry.line));
          }
          return;
        }
        if (stack.length) {
          const count = (line.match(/%%/g) || []).length;
          stack[stack.length - 1].markers += count;
        }
      });
      stack.forEach((entry) => {
        diagnostics.push(diagnostic("error", "\u80CC\u8BF5\u5757\u7F3A\u5C11\u7ED3\u675F\u6807\u8BB0 ::::\u3002", entry.line));
      });
    }
    function analyzeQuizifySyntax(source) {
      const text = String(source || "");
      const inlineText = maskFencedCode(text);
      const locate = createLineLocator(text);
      const diagnostics = [];
      const lines = text.split(/\r?\n/);
      analyzeFillBlanks(inlineText, diagnostics, locate);
      analyzeReveal(inlineText, diagnostics, locate);
      analyzeAnnotations(inlineText, diagnostics, locate);
      analyzeAudio(inlineText, diagnostics, locate);
      analyzeChoiceBlocks(lines, diagnostics);
      analyzeContainers(lines, diagnostics);
      analyzeReciteBlocks(lines, diagnostics);
      diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
      return diagnostics;
    }
    function trimPreview(value, max = 40) {
      const text = String(value || "").replace(/\s+/g, " ").trim();
      return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
    }
    function previewItem(kind, title, line, meta = {}) {
      return { kind, title, line, meta };
    }
    function collectInlinePreview(source, items, locate) {
      const text = maskFencedCode(source);
      for (const match of text.matchAll(/\{\{(.*?)\}\}/gs)) {
        const pos = locate(match.index);
        const answer = trimPreview(match[1] || "\u7A7A\u7B54\u6848");
        items.push(previewItem("fitb", "\u586B\u7A7A", pos.line, { answer }));
      }
      for (const match of text.matchAll(/\[\[([\s\S]*?)\]\]/g)) {
        const pos = locate(match.index);
        const [question = "", answer = ""] = match[1].split("||");
        items.push(previewItem("reveal", "\u63ED\u793A", pos.line, {
          question: trimPreview(question || "\u7A7A\u9898\u5E72"),
          answer: trimPreview(answer || "\u7A7A\u7B54\u6848")
        }));
      }
      for (const match of text.matchAll(/\[(.*?)\]\^\((.*?)\)\^/gs)) {
        const pos = locate(match.index);
        items.push(previewItem("annotation", "\u6279\u6CE8", pos.line, {
          text: trimPreview(match[1] || "\u7A7A\u6B63\u6587"),
          note: trimPreview(match[2] || "\u7A7A\u6279\u6CE8")
        }));
      }
      for (const match of text.matchAll(/!audio\[(.*?)\]\((.*?)\)/g)) {
        const pos = locate(match.index);
        items.push(previewItem("audio", "\u97F3\u9891", pos.line, {
          title: trimPreview(match[1] || "\u65E0\u6807\u9898"),
          url: trimPreview(match[2] || "\u65E0\u6587\u4EF6")
        }));
      }
    }
    function collectChoicePreview(lines, items) {
      let index = 0;
      let fence = null;
      while (index < lines.length) {
        const next = nextFence(lines[index], fence);
        if (fence || next) {
          fence = next;
          index++;
          continue;
        }
        if (!/^;;;\s*$/.test(lines[index])) {
          index++;
          continue;
        }
        const startLine = index + 1;
        const optionLines = [];
        let blockFence = null;
        index++;
        while (index < lines.length && (blockFence || !/^;;;[A-Za-z]*\s*$/.test(lines[index].trim()))) {
          optionLines.push({ text: lines[index], line: index + 1 });
          blockFence = nextFence(lines[index], blockFence);
          index++;
        }
        const close = index < lines.length ? /^;;;([A-Za-z]*)\s*$/.exec(lines[index].trim()) : null;
        const options = choiceOptionsFromLines(optionLines).map((option) => option.letter);
        const answers = close ? uniqueSortedLetters(close[1]) : "";
        items.push(previewItem(answers.length === 1 ? "single" : "multiple", answers.length === 1 ? "\u5355\u9009" : "\u591A\u9009", startLine, {
          options: options.join("") || "\u65E0\u9009\u9879",
          answers: answers || "\u65E0\u7B54\u6848"
        }));
        index++;
      }
    }
    function collectContainerPreview(lines, items) {
      let fence = null;
      lines.forEach((line, idx) => {
        const lineNo = idx + 1;
        const collapse = /^:::\s+(.+?)\s*$/.exec(line.trim());
        const next = nextFence(line, fence);
        if (fence || next) {
          fence = next;
          return;
        }
        if (collapse) {
          items.push(previewItem("collapse", "\u6298\u53E0", lineNo, {
            title: trimPreview(collapse[1])
          }));
        }
        const recite = /^::::\s+recite(?:\s+(.*?))?\s*$/i.exec(line.trim());
        if (recite) {
          const options = Object.fromEntries(
            String(recite[1] || "").split(/\s+/).map((part) => part.split("=", 2)).filter((pair) => pair.length === 2)
          );
          items.push(previewItem("recite", "\u80CC\u8BF5", lineNo, {
            mask: options.mask || "40",
            mode: options.mode || "mixed"
          }));
        }
        const tab = /^===\s+(.+?)\s*$/.exec(line.trim());
        if (tab) {
          items.push(previewItem("tab", "\u6807\u7B7E\u9875", lineNo, {
            title: trimPreview(tab[1])
          }));
        }
      });
    }
    function collectQuizifyPreview(source) {
      const text = String(source || "");
      const lines = text.split(/\r?\n/);
      const locate = createLineLocator(text);
      const items = [];
      collectInlinePreview(text, items, locate);
      collectChoicePreview(lines, items);
      collectContainerPreview(lines, items);
      items.sort((a, b) => a.line - b.line || a.title.localeCompare(b.title));
      return items;
    }
    function summarizeDiagnostics(diagnostics) {
      const errors = diagnostics.filter((item) => item.severity === "error").length;
      const warnings = diagnostics.filter((item) => item.severity === "warning").length;
      if (!errors && !warnings) return "\u8BED\u6CD5\u901A\u8FC7";
      if (errors && warnings) return `${errors} \u4E2A\u9519\u8BEF\uFF0C${warnings} \u4E2A\u8B66\u544A`;
      if (errors) return `${errors} \u4E2A\u9519\u8BEF`;
      return `${warnings} \u4E2A\u8B66\u544A`;
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
})();
if (typeof module === 'object' && module.exports) module.exports = globalThis.QuizifySyntax;
