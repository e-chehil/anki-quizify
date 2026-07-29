import {
  fenceMarker,
  nextFence,
  uniqueSortedLetters
} from "../../shared/markdown-structure.js";
import {
  findDisplayMathEndOnLine
} from "../../shared/math.js";

export function createParserTools(state) {
  function readLine(src, offset) {
    const end = src.indexOf("\n", offset);
    if (end === -1) {
      return { line: src.slice(offset), raw: src.slice(offset), next: src.length };
    }
    return {
      line: src.slice(offset, end),
      raw: src.slice(offset, end + 1),
      next: end + 1
    };
  }

  function validMathBlockEnd(src, offset) {
    return findDisplayMathEndOnLine(src, offset);
  }

  function trimBlankEdges(lines) {
    const copy = lines.slice();
    while (copy.length && copy[0].trim() === "") copy.shift();
    while (copy.length && copy[copy.length - 1].trim() === "") copy.pop();
    return copy;
  }

  function nextName(kind) {
    if (kind === "fitb") return `${state.fieldPrefix}fitb-${state.fitbCounter++}`;
    if (kind === "mcq") return `${state.fieldPrefix}mcq-${state.mcqCounter++}`;
    if (kind === "tabs") return `${state.fieldPrefix}tabs-${state.tabsCounter++}`;
    return `${state.fieldPrefix}${kind}`;
  }

  function inlineTokens(lexer, text) {
    return lexer.inlineTokens ? lexer.inlineTokens(text, []) : [];
  }

  function markerStart(src, marker) {
    const index = src.indexOf(marker);
    return index >= 0 ? index : undefined;
  }

  function regexStart(src, pattern) {
    const match = src.match(pattern);
    return match ? match.index : undefined;
  }

  function parseChoiceOptions(raw, lexer) {
    const options = [];
    const seen = new Set();
    const source = String(raw || "");
    let offset = 0;
    let fence = null;
    let mathEnd = -1;

    while (offset < source.length) {
      const continuingMath = !fence && offset < mathEnd;
      const detectedMathEnd = !fence && !continuingMath
        ? validMathBlockEnd(source, offset)
        : -1;
      const entry = readLine(source, offset);
      offset = entry.next;
      if (continuingMath) continue;
      if (detectedMathEnd > mathEnd) mathEnd = detectedMathEnd;

      const next = nextFence(entry.line, fence);
      if (fence || next) {
        fence = next;
        continue;
      }

      const match = /^([A-Za-z])\. ?(.+)$/.exec(entry.line.trim());
      if (!match) continue;

      const description = match[2].trim();
      const letter = match[1].toUpperCase();
      options.push({
        duplicate: seen.has(letter),
        letter,
        description,
        tokens: inlineTokens(lexer, description)
      });
      seen.add(letter);
    }

    return options;
  }

  function validChoiceBlock(options, correct) {
    if (options.length < 2 || !correct) return false;
    if (options.some((option) => option.duplicate || !option.description)) return false;
    const letters = new Set(options.map((option) => option.letter));
    return correct.split("").every((letter) => letters.has(letter));
  }

  function parseChoiceBlock(src, lexer) {
    const opener = readLine(src, 0);
    if (!/^;;;\s*$/.test(opener.line)) return null;

    let offset = opener.next;
    let fence = null;
    let mathEnd = -1;
    const optionLines = [];

    while (offset < src.length) {
      const insideMath =
        !fence &&
        (offset < mathEnd ||
          ((mathEnd = validMathBlockEnd(src, offset)) > offset));
      const entry = readLine(src, offset);
      const close =
        !fence && !insideMath && /^;;;([A-Za-z]+)\s*$/.exec(entry.line);
      offset = entry.next;

      if (close) {
        const correct = uniqueSortedLetters(close[1]);
        const options = parseChoiceOptions(optionLines.join("\n"), lexer);
        if (!validChoiceBlock(options, correct)) return null;
        return {
          raw: src.slice(0, offset),
          options,
          correct
        };
      }

      optionLines.push(entry.line);
      if (!insideMath) fence = nextFence(entry.line, fence);
    }

    return null;
  }

  function parseTabsBlock(src, lexer) {
    const first = readLine(src, 0);
    const firstMatch = /^===\s+(.+?)\s*$/.exec(first.line);
    if (!firstMatch) return null;

    const tabs = [];
    let title = firstMatch[1].trim();
    let lines = [];
    let offset = first.next;
    let fence = null;
    let mathEnd = -1;

    while (offset < src.length) {
      const insideMath =
        !fence &&
        (offset < mathEnd ||
          ((mathEnd = validMathBlockEnd(src, offset)) > offset));
      const entry = readLine(src, offset);
      offset = entry.next;

      if (insideMath) {
        lines.push(entry.line);
        continue;
      }

      if (fence) {
        lines.push(entry.line);
        fence = nextFence(entry.line, fence);
        continue;
      }

      if (fenceMarker(entry.line)) {
        lines.push(entry.line);
        fence = nextFence(entry.line, fence);
        continue;
      }

      if (/^===\s*$/.test(entry.line)) {
        tabs.push({
          title,
          titleTokens: inlineTokens(lexer, title),
          tokens: lexer.blockTokens(trimBlankEdges(lines).join("\n"))
        });
        return { raw: src.slice(0, offset), tabs };
      }

      const nextMatch = /^===\s+(.+?)\s*$/.exec(entry.line);
      if (nextMatch) {
        tabs.push({
          title,
          titleTokens: inlineTokens(lexer, title),
          tokens: lexer.blockTokens(trimBlankEdges(lines).join("\n"))
        });
        title = nextMatch[1].trim();
        lines = [];
      } else {
        lines.push(entry.line);
      }
    }

    return null;
  }

  function flattenTabTokens(tabs, key) {
    return tabs.flatMap((tab) => tab[key] || []);
  }

  function flattenChoiceTokens(options) {
    return options.flatMap((option) => option.tokens || []);
  }

  function parseReciteOptions(source) {
    const options = { mask: 40, mode: "mixed" };
    String(source || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach((part) => {
        const match = /^([A-Za-z][\w-]*)=(\S+)$/.exec(part);
        if (!match) return;
        const key = match[1].toLowerCase();
        const value = match[2].toLowerCase();
        if (key === "mask" && /^\d{1,3}$/.test(value)) {
          options.mask = Math.max(0, Math.min(100, Number(value)));
        } else if (key === "mode" && ["auto", "manual", "mixed"].includes(value)) {
          options.mode = value;
        }
      });
    return options;
  }

  function parseReciteBlock(src, lexer) {
    const opener = /^::::[ \t]+recite(?:[ \t]+([^\r\n]*?))?[ \t]*(?:\n|$)/i.exec(src);
    if (!opener) return null;

    let depth = 1;
    let offset = opener[0].length;
    let fence = null;
    let mathEnd = -1;
    const lines = [];

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
      } else if (/^::::[ \t]+recite(?:[ \t]|$)/i.test(entry.line)) {
        depth++;
        lines.push(entry.line);
      } else if (/^::::\s*$/.test(entry.line)) {
        depth--;
        if (depth > 0) lines.push(entry.line);
      } else {
        lines.push(entry.line);
      }
    }

    if (depth !== 0) return null;
    const options = parseReciteOptions(opener[1]);
    return {
      raw: src.slice(0, offset),
      mask: options.mask,
      mode: options.mode,
      tokens: lexer.blockTokens(trimBlankEdges(lines).join("\n"))
    };
  }

  const reciteStopWordsEn = new Set([
    "a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet",
    "at", "by", "in", "of", "on", "to", "up", "with", "as", "is", "are",
    "was", "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "that", "this", "these", "those", "it", "he", "she", "they", "we",
    "i", "you", "my", "your", "his", "her", "its", "our", "their"
  ]);
  const reciteStopWordsCn = new Set(
    "的了和是就都而及与着或之在把被给让向从于地得吗呢吧啊呀".split("")
  );
  const reciteStopWordsRu = new Set([
    "а", "без", "бы", "был", "была", "были", "было", "быть", "в", "вам",
    "вас", "ваш", "ваша", "ваше", "ваши", "во", "вы", "для", "до", "его",
    "ее", "её", "ей", "ему", "если", "есть", "же", "за", "и", "из", "или",
    "им", "их", "к", "как", "ко", "ли", "меня", "мне", "мой", "моя", "мое",
    "моё", "мои", "мы", "на", "не", "него", "нее", "неё", "ней", "нем", "нём",
    "нет", "ни", "но", "о", "об", "он", "она", "они", "оно", "от", "по", "под",
    "при", "с", "себя", "со", "та", "те", "то", "тот", "ты", "у", "что", "эта",
    "эти", "это", "этот", "я"
  ]);

  function tokenizeAutomaticReciteText(text) {
    const source = String(text || "");
    // Keep Han characters individually maskable, while treating words in
    // Cyrillic, accented Latin and other alphabetic scripts as whole units.
    // Unicode property escapes are part of ES2018; the explicit number branch
    // also covers non-ASCII decimal digits used by common writing systems.
    const pattern = /(?:[$¥€£₽₹₩])?\p{N}+(?:[.,\u066b\u066c]\p{N}+)*(?:%|kg|km|cm|mm|g|lb|oz|k|m|bn)?|\p{Script=Han}|[\p{L}\p{M}]+(?:['’/\-\u2010\u2011][\p{L}\p{M}]+)*/gu;
    const tokens = [];
    let offset = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      if (match.index > offset) {
        tokens.push({ text: source.slice(offset, match.index), hideable: false, manual: false });
      }
      const value = match[0];
      const isEnglish = /^[A-Za-z]/.test(value);
      const isChinese = /^\p{Script=Han}$/u.test(value);
      const isCyrillic = /^\p{Script=Cyrillic}/u.test(value);
      const hideable = isEnglish
        ? !reciteStopWordsEn.has(value.toLowerCase())
        : isChinese
          ? !reciteStopWordsCn.has(value)
          : isCyrillic
            ? !reciteStopWordsRu.has(value.toLowerCase())
            : true;
      tokens.push({ text: value, hideable, manual: false });
      offset = pattern.lastIndex;
    }
    if (offset < source.length) {
      tokens.push({ text: source.slice(offset), hideable: false, manual: false });
    }
    return tokens;
  }

  function tokenizeReciteText(text, mode = "mixed") {
    const normalizedMode = ["auto", "manual", "mixed"].includes(mode) ? mode : "mixed";
    const source = String(text || "");
    const tokens = [];
    const groups = /%%([^%\n](?:[^\n]*?[^%\n])?)%%/g;
    let offset = 0;
    let match;

    function appendPlain(value) {
      if (!value) return;
      if (normalizedMode === "manual") {
        tokens.push({ text: value, hideable: false, manual: false });
      } else {
        tokens.push(...tokenizeAutomaticReciteText(value));
      }
    }

    while ((match = groups.exec(source)) !== null) {
      appendPlain(source.slice(offset, match.index));
      const value = match[1];
      if (normalizedMode === "auto") {
        tokens.push(...tokenizeAutomaticReciteText(value));
      } else {
        tokens.push({ text: value, hideable: Boolean(value.trim()), manual: true });
      }
      offset = groups.lastIndex;
    }
    appendPlain(source.slice(offset));
    return tokens;
  }

  function canReciteScrub(pointerType = "mouse", button = 0) {
    return Number(button) === 0 && String(pointerType || "mouse").toLowerCase() !== "touch";
  }

  function canArmReciteTouchScrub(pointerType = "") {
    return String(pointerType).toLowerCase() === "touch";
  }

  function isReciteScrubMove(dx, dy, threshold = 6) {
    return Math.hypot(Number(dx) || 0, Number(dy) || 0) >= threshold;
  }

  return Object.freeze({
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
  });
}
