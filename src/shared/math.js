import { nextFence } from "./markdown-structure.js";
import { t } from "./i18n.js";

export const KATEX_DELIMITERS = Object.freeze(
  [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false }
  ].map(Object.freeze)
);

export const KATEX_BLOCK_DELIMITERS = Object.freeze(
  KATEX_DELIMITERS.filter((delimiter) => delimiter.display)
);

export const MATH_PLACEHOLDER_CLASS = "quizify-math";
export const MATH_PLACEHOLDER_SELECTOR = "[data-quizify-math]";
export const MAX_MATH_DELIMITER_HINTS = 1024;
export const MAX_MATH_EXPRESSIONS = 256;
export const MAX_TEX_SOURCE_LENGTH = 16 * 1024;
export const MAX_TOTAL_TEX_SOURCE_LENGTH = 32 * 1024;
const KATEX_IGNORED_ANCESTORS =
  "code, pre, script, style, textarea, option, noscript, kbd, title, template";

const MARKDOWN_HTML_TAGS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body br " +
    "button canvas caption cite code col colgroup data datalist dd del details dfn " +
    "dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 " +
    "h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li " +
    "link main map mark menu meta meter nav noscript object ol optgroup option output " +
    "p picture pre progress q rp rt ruby s samp script search section select slot small " +
    "source span strong style sub summary sup table tbody td template textarea tfoot " +
    "th thead time title tr track u ul var video wbr svg math " +
    "altglyph altglyphdef altglyphitem animate animatecolor animatemotion " +
    "animatetransform circle clippath defs desc ellipse filter font font-face " +
    "font-face-format font-face-name font-face-src font-face-uri g glyph " +
    "glyphref hkern line lineargradient marker mask metadata mpath path pattern " +
    "polygon polyline radialgradient rect set stop switch symbol text textpath " +
    "tref tspan use view vkern feblend fecolormatrix fecomponenttransfer " +
    "fecomposite feconvolvematrix fediffuselighting fedisplacementmap " +
    "fedistantlight fedropshadow feflood fefunca fefuncb fefuncg fefuncr " +
    "fegaussianblur feimage femerge femergenode femorphology feoffset " +
    "fepointlight fespecularlighting fespotlight fetile feturbulence " +
    "annotation annotation-xml maction maligngroup malignmark menclose merror " +
    "mfenced mfrac mglyph mi mlabeledtr mlongdiv mmultiscripts mn mo mover " +
    "mpadded mphantom mprescripts mroot mrow ms mscarries mscarry msgroup " +
    "msline mspace msqrt msrow mstack mstyle msub msubsup msup mtable mtd " +
    "mtext mtr munder munderover none semantics"
  ).split(" ")
);
const MATH_IGNORED_HTML_TAGS = new Set(
  "pre code script style textarea option noscript kbd title template".split(" ")
);
const MARKDOWN_HTML_BLOCK_TAGS = new Set(
  (
    "address article aside base basefont blockquote body caption center col colgroup " +
    "dd details dialog dir div dl dt fieldset figcaption figure footer form frame " +
    "frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe legend li link " +
    "main menu menuitem nav noframes ol optgroup option p param search section " +
    "summary table tbody td tfoot th thead title tr track ul"
  ).split(" ")
);
const delimiterStartPatterns = new WeakMap();

function delimiterStartPattern(delimiters) {
  let pattern = delimiterStartPatterns.get(delimiters);
  if (!pattern) {
    const alternatives = delimiters.map((delimiter) =>
      delimiter.left.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    pattern = new RegExp(alternatives.join("|"), "g");
    delimiterStartPatterns.set(delimiters, pattern);
  }
  return pattern;
}

function rawDelimiterStart(source, delimiters, fromIndex = 0) {
  const immediate = delimiters.find((delimiter) =>
    source.startsWith(delimiter.left, fromIndex)
  );
  if (immediate) return { index: fromIndex, delimiter: immediate };

  const pattern = delimiterStartPattern(delimiters);
  pattern.lastIndex = fromIndex;
  const match = pattern.exec(source);
  if (!match) return;
  const selected = delimiters.find((delimiter) => match[0] === delimiter.left);
  return { index: match.index, delimiter: selected };
}

export function findPotentialMathDelimiterStart(
  source,
  delimiters = KATEX_DELIMITERS,
  fromIndex = 0
) {
  return rawDelimiterStart(
    String(source ?? ""),
    delimiters,
    Math.max(0, Number(fromIndex) || 0)
  )?.index;
}

export function hasExcessiveMathDelimiters(
  source,
  limit = MAX_MATH_DELIMITER_HINTS
) {
  // This is a raw safety cap, deliberately independent of Markdown ownership.
  // Even a future parser/container edge cannot hide an adversarial delimiter
  // flood. More than 1024 hints inside code/HTML is pathological field content
  // too, so the conservative plain-text fallback is preferable there as well.
  const text = String(source ?? "");
  const pattern = delimiterStartPattern(KATEX_DELIMITERS);
  pattern.lastIndex = 0;
  let count = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (escapedAt(text, match.index)) {
      // `\$$` escapes only the first dollar; the overlapping second dollar is
      // still a real inline hint and must not disappear behind the `$$` match.
      pattern.lastIndex = match.index + 1;
      continue;
    }
    count++;
    if (count > limit) return true;
  }
  return false;
}

function asciiLetter(character) {
  const code = character?.charCodeAt(0) || 0;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function asciiTagNameCharacter(character) {
  const code = character?.charCodeAt(0) || 0;
  return (
    asciiLetter(character) ||
    (code >= 48 && code <= 57) ||
    character === "-"
  );
}

function htmlTagHeadAt(source, start, allowClosing = true) {
  if (source[start] !== "<") return;
  let cursor = start + 1;
  let closing = false;
  if (source[cursor] === "/") {
    if (!allowClosing) return;
    closing = true;
    cursor++;
  }
  const nameStart = cursor;
  if (!asciiLetter(source[cursor])) return;
  while (asciiTagNameCharacter(source[++cursor]));
  const terminator = source[cursor];
  if (
    terminator !== "/" &&
    terminator !== ">" &&
    !/\s/.test(terminator || "")
  ) {
    return;
  }
  return {
    name: source.slice(nameStart, cursor).toLowerCase(),
    end: cursor,
    closing
  };
}

// For each character position and each quote state, record the first `>` that
// would end a tag scanned forward from there. This is the same three-state
// machine used by tagEnd, evaluated once from right to left. Incomplete,
// overlapping HTML-looking prefixes can then be rejected in constant time
// instead of each rescanning the entire suffix.
function buildHtmlTagEndIndex(source) {
  const text = String(source ?? "");
  if (!text.includes("<")) return;
  const stateCount = 3;
  const none = 0;
  const single = 1;
  const double = 2;
  const ends = new Int32Array((text.length + 1) * stateCount);

  for (let position = text.length - 1; position >= 0; position--) {
    const current = position * stateCount;
    const next = current + stateCount;
    const character = text[position];

    ends[current + none] = character === ">"
      ? position + 1
      : character === "'"
        ? ends[next + single]
        : character === '"'
          ? ends[next + double]
          : ends[next + none];
    ends[current + single] = character === "'"
      ? ends[next + none]
      : ends[next + single];
    ends[current + double] = character === '"'
      ? ends[next + none]
      : ends[next + double];
  }

  return { ends, stateCount };
}

function quotedTagEnd(source, start, htmlIndex) {
  if (htmlIndex) {
    return htmlIndex.ends[(start + 2) * htmlIndex.stateCount] || -1;
  }
  let quote = "";
  for (let index = start + 2; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return -1;
}

function validKnownHtmlTagSyntax(source, head, end) {
  let cursor = head.end;
  if (head.closing) {
    while (/\s/.test(source[cursor] || "")) cursor++;
    return source[cursor] === ">" && cursor + 1 === end;
  }

  while (cursor < end) {
    let separated = false;
    while (/\s/.test(source[cursor] || "")) {
      separated = true;
      cursor++;
    }
    if (source[cursor] === ">") return cursor + 1 === end;
    if (source[cursor] === "/") {
      return source[cursor + 1] === ">" && cursor + 2 === end;
    }
    if (!separated || !/[A-Za-z_:]/.test(source[cursor] || "")) return false;
    cursor++;
    while (/[A-Za-z0-9_.:-]/.test(source[cursor] || "")) cursor++;
    while (/\s/.test(source[cursor] || "")) cursor++;
    if (source[cursor] !== "=") continue;
    cursor++;
    while (/\s/.test(source[cursor] || "")) cursor++;
    const quote = source[cursor] === '"' || source[cursor] === "'"
      ? source[cursor++]
      : "";
    if (quote) {
      while (cursor < end && source[cursor] !== quote) cursor++;
      if (source[cursor] !== quote) return false;
      cursor++;
    } else {
      const valueStart = cursor;
      while (
        cursor < end &&
        !/[\s"'=<>`]/.test(source[cursor] || "")
      ) {
        cursor++;
      }
      if (cursor === valueStart) return false;
    }
  }
  return false;
}

function tagEnd(source, start, htmlIndex) {
  if (source.startsWith("<!--", start)) {
    const end = source.indexOf("-->", start + 4);
    return end < 0 ? source.length : end + 3;
  }
  if (source.startsWith("<![CDATA[", start)) {
    const end = source.indexOf("]]>", start + 9);
    return end < 0 ? source.length : end + 3;
  }

  const head = htmlTagHeadAt(source, start);
  const knownTag = head && MARKDOWN_HTML_TAGS.has(head.name);
  if (knownTag) {
    const end = quotedTagEnd(source, start, htmlIndex);
    if (end < 0) return -1;
    return validKnownHtmlTagSyntax(source, head, end) ? end : -1;
  }
  if (source.startsWith("<?", start)) {
    const end = source.indexOf("?>", start + 2);
    return end < 0 ? source.length : end + 2;
  }
  if (/^<![A-Za-z]/.test(source.slice(start, start + 64))) {
    const end = source.indexOf(">", start + 3);
    return end < 0 ? source.length : end + 1;
  }

  // A TeX relation such as `$x<br y$` can look like the beginning of an HTML
  // tag without ever becoming markup. Only syntax that Marked recognizes as
  // complete HTML is a hard formula boundary.
  return -1;
}

function htmlBoundaryAt(source, index, htmlIndex) {
  return source[index] === "<" ? tagEnd(source, index, htmlIndex) : -1;
}

export function findMathDelimiterEnd(
  source,
  delimiter,
  startIndex,
  htmlIndex
) {
  const text = String(source ?? "");
  let tagEndIndex = htmlIndex;
  let htmlCandidateCount = 0;
  let braceDepth = 0;

  // Keep this aligned with KaTeX's delimiter scanner: escaped characters and
  // delimiter-looking text inside TeX groups must not close the expression.
  for (let index = startIndex; index < text.length; index++) {
    if (
      braceDepth <= 0 &&
      text.startsWith(delimiter.right, index)
    ) {
      return index;
    }

    const character = text[index];
    if (!delimiter.display && (character === "\n" || character === "\r")) {
      return -1;
    } else if (character === "<") {
      // Ordinary formulas should not pay to index the whole remaining
      // Markdown source. Switch to the shared suffix index only after enough
      // incomplete HTML-looking candidates could otherwise repeat work.
      if (!tagEndIndex && ++htmlCandidateCount >= 16) {
        tagEndIndex = buildHtmlTagEndIndex(text);
      }
      if (htmlBoundaryAt(text, index, tagEndIndex) >= 0) return -1;
    } else if (character === "\\") {
      if (
        !delimiter.display &&
        (text[index + 1] === "\n" || text[index + 1] === "\r")
      ) {
        return -1;
      }
      index++;
    } else if (character === "{") {
      braceDepth++;
    } else if (character === "}") {
      braceDepth--;
    }
  }

  return -1;
}

function findHtmlCrossingDelimiterEnd(
  source,
  delimiter,
  startIndex,
  htmlIndex
) {
  let braceDepth = 0;
  let crossedHtml = false;
  for (let index = startIndex; index < source.length; index++) {
    if (
      braceDepth <= 0 &&
      source.startsWith(delimiter.right, index)
    ) {
      return crossedHtml ? index : -1;
    }

    const character = source[index];
    if (!delimiter.display && (character === "\n" || character === "\r")) {
      return -1;
    }
    if (character === "<") {
      const end = htmlBoundaryAt(source, index, htmlIndex);
      if (end >= 0) {
        crossedHtml = true;
        index = end - 1;
        continue;
      }
    }
    if (character === "\\") {
      if (
        !delimiter.display &&
        (source[index + 1] === "\n" || source[index + 1] === "\r")
      ) {
        return -1;
      }
      index++;
    } else if (character === "{") {
      braceDepth++;
    } else if (character === "}") {
      braceDepth--;
    }
  }
  return -1;
}

export function matchMathDelimiterAt(
  source,
  startIndex = 0,
  delimiters = KATEX_DELIMITERS,
  htmlIndex
) {
  const text = String(source ?? "");
  const delimiter = delimiters.find((candidate) =>
    text.startsWith(candidate.left, startIndex)
  );
  if (!delimiter) return;

  const contentStart = startIndex + delimiter.left.length;
  if (text.indexOf(delimiter.right, contentStart) < 0) return;
  const contentEnd = findMathDelimiterEnd(
    text,
    delimiter,
    contentStart,
    htmlIndex
  );
  if (contentEnd < 0) return;

  const rawEnd = contentEnd + delimiter.right.length;
  return {
    raw: text.slice(startIndex, rawEnd),
    text: text.slice(contentStart, contentEnd),
    left: delimiter.left,
    right: delimiter.right,
    display: delimiter.display,
    index: startIndex,
    end: rawEnd
  };
}

export function matchMathDelimiter(source, delimiters = KATEX_DELIMITERS) {
  return matchMathDelimiterAt(source, 0, delimiters);
}

function lowerBound(records, position) {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (records[middle].position < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

function buildMathSearchIndex(
  text,
  delimiters,
  htmlIndex = buildHtmlTagEndIndex(text)
) {
  const balanceAt = new Int32Array(text.length + 1);
  const escaped = new Uint8Array(text.length);
  let balance = 0;
  let slashRun = 0;
  for (let index = 0; index < text.length; index++) {
    balanceAt[index] = balance;
    escaped[index] = slashRun % 2;
    const character = text[index];
    if (character === "\\") {
      slashRun++;
      continue;
    }
    if (!escaped[index]) {
      if (character === "{") balance++;
      else if (character === "}") balance--;
    }
    slashRun = 0;
  }
  balanceAt[text.length] = balance;

  const regionAt = new Int32Array(text.length);
  const lineAt = new Uint32Array(text.length + 1);
  let line = 0;
  for (let index = 0; index < text.length; index++) {
    lineAt[index] = line;
    if (
      text[index] === "\n" ||
      (text[index] === "\r" && text[index + 1] !== "\n")
    ) {
      line++;
    }
  }
  lineAt[text.length] = line;

  let region = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const end = !escaped[cursor]
      ? htmlBoundaryAt(text, cursor, htmlIndex)
      : -1;
    if (end >= 0) {
      regionAt.fill(-1, cursor, end);
      cursor = end;
      region++;
    } else {
      regionAt[cursor++] = region;
    }
  }

  const closers = new Map();
  for (const right of new Set(delimiters.map((delimiter) => delimiter.right))) {
    const display = delimiters.find((delimiter) => delimiter.right === right)?.display;
    const records = [];
    let position = text.indexOf(right);
    while (position >= 0) {
      if (!escaped[position] && regionAt[position] >= 0) {
        records.push({
          position,
          region: regionAt[position],
          line: lineAt[position],
          balance: balanceAt[position],
          suffixMin: balanceAt[position]
        });
      }
      position = text.indexOf(right, position + 1);
    }
    for (let index = records.length - 2; index >= 0; index--) {
      if (
        records[index].region === records[index + 1].region &&
        (display || records[index].line === records[index + 1].line)
      ) {
        records[index].suffixMin = Math.min(
          records[index].balance,
          records[index + 1].suffixMin
        );
      }
    }
    closers.set(right, records);
  }

  return { balanceAt, escaped, regionAt, lineAt, closers, htmlIndex };
}

function indexedMathDelimiterStart(
  text,
  delimiters,
  fromIndex,
  index = buildMathSearchIndex(text, delimiters)
) {
  let searchFrom = fromIndex;
  while (searchFrom < text.length) {
    const candidate = rawDelimiterStart(text, delimiters, searchFrom);
    if (!candidate) return;
    const { delimiter, index: start } = candidate;
    const region = index.regionAt[start];
    if (!index.escaped[start] && region >= 0) {
      const records = index.closers.get(delimiter.right) || [];
      const recordIndex = lowerBound(records, start + delimiter.left.length);
      const record = records[recordIndex];
      if (
        record?.region === region &&
        (delimiter.display || record.line === index.lineAt[start]) &&
        record.suffixMin <= index.balanceAt[start]
      ) {
        if (
          matchMathDelimiterAt(text, start, delimiters, index.htmlIndex)
        ) {
          return start;
        }
      }
      // Greedily pair a candidate while skipping complete HTML markup. If
      // that lexical pair crosses an HTML boundary, reject the pair together
      // instead of reusing its closing `$` as the opener of a phantom formula.
      if (
        record &&
        record.region !== region &&
        (delimiter.display || record.line === index.lineAt[start])
      ) {
        const rejectedEnd = findHtmlCrossingDelimiterEnd(
          text,
          delimiter,
          start + delimiter.left.length,
          index.htmlIndex
        );
        if (rejectedEnd >= 0) {
          searchFrom = rejectedEnd + delimiter.right.length;
          continue;
        }
      }
    }
    searchFrom = start + (index.escaped[start] ? 1 : delimiter.left.length);
  }
}

function indexedMathDelimiterMatchAt(text, start, delimiters, index) {
  const delimiter = delimiters.find((candidate) =>
    text.startsWith(candidate.left, start)
  );
  if (!delimiter || index.escaped[start] || index.regionAt[start] < 0) return;
  const records = index.closers.get(delimiter.right) || [];
  const record = records[lowerBound(records, start + delimiter.left.length)];
  if (
    record?.region !== index.regionAt[start] ||
    (!delimiter.display && record.line !== index.lineAt[start]) ||
    record.suffixMin > index.balanceAt[start]
  ) {
    return;
  }
  return matchMathDelimiterAt(text, start, delimiters, index.htmlIndex);
}

export function findMathRanges(source, delimiters = KATEX_DELIMITERS) {
  const text = String(source ?? "");
  const searchIndex = buildMathSearchIndex(text, delimiters);
  const ranges = [];
  let offset = 0;
  while (offset < text.length) {
    const start = indexedMathDelimiterStart(
      text,
      delimiters,
      offset,
      searchIndex
    );
    if (start === undefined) break;
    const match = matchMathDelimiterAt(
      text,
      start,
      delimiters,
      searchIndex.htmlIndex
    );
    ranges.push(match);
    offset = match.end;
  }
  return ranges;
}

export function findMathDelimiterStart(
  source,
  delimiters = KATEX_DELIMITERS,
  fromIndex = 0
) {
  const text = String(source ?? "");
  let searchFrom = Math.max(0, Number(fromIndex) || 0);
  const first = rawDelimiterStart(text, delimiters, searchFrom);
  if (!first) return;

  // A raw delimiter search cannot tell whether a candidate is inside an HTML
  // tag/attribute. Switch to the indexed scanner whenever HTML-looking input
  // occurs in the remaining source so math can never start inside markup.
  if (text.indexOf("<", searchFrom) >= 0) {
    return indexedMathDelimiterStart(
      text,
      delimiters,
      searchFrom,
      buildMathSearchIndex(text, delimiters)
    );
  }
  const htmlIndex = buildHtmlTagEndIndex(text);
  if (
    !escapedAt(text, first.index) &&
    matchMathDelimiterAt(text, first.index, delimiters, htmlIndex)
  ) {
    return first.index;
  }
  searchFrom = first.index +
    (escapedAt(text, first.index) ? 1 : first.delimiter.left.length);
  const impossible = new Set();
  let failedCandidates = 1;

  while (searchFrom < text.length) {
    const available = delimiters.filter(
      (delimiter) => !impossible.has(delimiter.left)
    );
    if (!available.length) return;
    const candidate = rawDelimiterStart(text, available, searchFrom);
    if (!candidate) return;
    const { delimiter, index } = candidate;

    if (escapedAt(text, index)) {
      searchFrom = index + 1;
      continue;
    }
    if (text.indexOf(delimiter.right, index + delimiter.left.length) < 0) {
      impossible.add(delimiter.left);
      searchFrom = index + delimiter.left.length;
      continue;
    }
    if (matchMathDelimiterAt(text, index, delimiters, htmlIndex)) return index;

    failedCandidates++;
    if (failedCandidates >= 16) {
      return indexedMathDelimiterStart(
        text,
        delimiters,
        index + delimiter.left.length,
        buildMathSearchIndex(text, delimiters, htmlIndex)
      );
    }
    searchFrom = index + delimiter.left.length;
  }
}

let displayMathOwnershipSource;
let displayMathOwnershipRanges = [];

function ownedDisplayMathRanges(source) {
  const text = String(source ?? "");
  if (displayMathOwnershipSource !== text) {
    displayMathOwnershipSource = text;
    displayMathOwnershipRanges = resolveInlineMathAndCodeRanges(text).math;
  }
  return displayMathOwnershipRanges;
}

export function findDisplayMathEndOnLine(source, offset = 0) {
  const text = String(source ?? "");
  const start = Math.max(0, Number(offset) || 0);
  let lineEnd = text.indexOf("\n", start);
  if (lineEnd < 0) lineEnd = text.length;
  if (lineEnd > start && text[lineEnd - 1] === "\r") lineEnd--;
  const line = text.slice(start, lineEnd);
  if (
    nextFence(line, null) ||
    (!line.includes("$$") && !line.includes("\\["))
  ) return -1;

  for (const range of ownedDisplayMathRanges(text)) {
    if (range.end <= start) continue;
    if (range.start >= lineEnd) break;
    if (range.start >= start && range.match?.display) return range.end;
  }
  return -1;
}

function escapedAt(source, index) {
  let slashCount = 0;
  while (index > 0 && source[--index] === "\\") slashCount++;
  return slashCount % 2 === 1;
}

function buildBacktickRunIndex(source) {
  const text = String(source ?? "");
  const runs = [];
  let start = text.indexOf("`");
  while (start >= 0) {
    let end = start + 1;
    while (text[end] === "`") end++;
    const escaped = escapedAt(text, start);
    runs.push({
      start,
      end,
      length: end - start,
      // A backslash escapes one backtick, not the rest of its run. Thus the
      // remaining suffix can still open a code span of one shorter length.
      openerStart: start + (escaped ? 1 : 0),
      openerLength: end - start - (escaped ? 1 : 0)
    });
    start = text.indexOf("`", end);
  }

  // CommonMark closes a code span at the first later *maximal* backtick run
  // having exactly the opener's length. Index that relation once so a series
  // of unmatched, differently-sized runs cannot repeatedly rescan the suffix.
  const nextCloser = new Int32Array(runs.length);
  nextCloser.fill(-1);
  const nextRunByLength = new Map();
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    if (run.openerLength > 0) {
      nextCloser[index] = nextRunByLength.get(run.openerLength) ?? -1;
    }
    nextRunByLength.set(run.length, index);
  }

  return { runs, nextCloser };
}

function backtickCodeRange(index, runIndex) {
  const opener = index.runs[runIndex];
  const closerIndex = index.nextCloser[runIndex];
  if (!opener?.openerLength || closerIndex < 0) return;
  return {
    start: opener.openerStart,
    end: index.runs[closerIndex].end,
    closerIndex
  };
}

function nextInlineCodeRange(index, fromIndex = 0, firstRunIndex = 0) {
  for (let runIndex = firstRunIndex; runIndex < index.runs.length; runIndex++) {
    const run = index.runs[runIndex];
    if (run.openerStart < fromIndex) continue;
    const range = backtickCodeRange(index, runIndex);
    if (range) return { ...range, runIndex };
  }
}

function closingHtmlCodeTag(source, start, htmlIndex) {
  const opener = htmlTagHeadAt(source, start, false);
  if (
    !opener ||
    !MATH_IGNORED_HTML_TAGS.has(opener.name)
  ) {
    return -1;
  }
  const openingEnd = tagEnd(source, start, htmlIndex);
  if (openingEnd < 0) return -1;
  if (opener.name === "option") {
    const optionClose = /<\/option\s*>|<option(?=[\s>])|<\/select\s*>/ig;
    optionClose.lastIndex = openingEnd;
    const boundary = optionClose.exec(source);
    if (!boundary) return source.length;
    return /^<\/option/i.test(boundary[0])
      ? boundary.index + boundary[0].length
      : boundary.index;
  }
  const closePattern = new RegExp(`</${opener.name}\\s*>`, "ig");
  closePattern.lastIndex = openingEnd;
  const closer = closePattern.exec(source);
  return closer ? closer.index + closer[0].length : source.length;
}

function findHtmlOpaqueRanges(source, htmlIndex = buildHtmlTagEndIndex(source)) {
  const text = String(source ?? "");
  const ranges = [];
  let index = text.indexOf("<");
  while (index >= 0) {
    const markupEnd = htmlBoundaryAt(text, index, htmlIndex);
    if (markupEnd >= 0) {
      const ignoredEnd = closingHtmlCodeTag(text, index, htmlIndex);
      const end = ignoredEnd >= 0 ? ignoredEnd : markupEnd;
      ranges.push({ start: index, end });
      index = text.indexOf("<", end);
      continue;
    }
    index = text.indexOf("<", index + 1);
  }
  return ranges;
}

function normalizeReferenceLabel(value) {
  return String(value ?? "")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function collectMarkdownReferenceLabels(source) {
  const labels = new Set();
  for (const { line, kind } of classifyMarkdownBlockLines(source)) {
    if (kind !== "plain") continue;
    // Be deliberately conservative: false negatives merely leave a formula
    // pipe protected, while a false-positive reference can make GFM split a
    // cell before Marked decides that the image/link was invalid.
    const match = /^ {0,3}\[((?:\\.|[^\]\\]){1,999})\]:[ \t]*(?:<[^<>\r\n]+>|[^ \t\r\n<>]+)(?:[ \t]+(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|\((?:\\.|[^)\\\r\n])*\)))?[ \t]*$/.exec(
      line
    );
    if (match) labels.add(normalizeReferenceLabel(match[1]));
  }
  return labels;
}

function buildMarkdownLinkScanIndex(source) {
  const length = source.length;
  const escaped = new Uint8Array(length);
  let slashRun = 0;
  for (let index = 0; index < length; index++) {
    escaped[index] = slashRun % 2;
    if (source[index] === "\\") slashRun++;
    else slashRun = 0;
  }

  const parenEnd = new Int32Array(length);
  parenEnd.fill(-1);
  const stack = [];
  for (let index = 0; index < length; index++) {
    if (source[index] === "\n" || source[index] === "\r") {
      stack.length = 0;
    } else if (!escaped[index] && source[index] === "(") {
      stack.push(index);
    } else if (!escaped[index] && source[index] === ")" && stack.length) {
      parenEnd[stack.pop()] = index;
    }
  }

  const nextClose = new Int32Array(length + 1);
  const nextSpecial = new Int32Array(length + 1);
  const nextBoundary = new Int32Array(length + 1);
  const nextLineBreak = new Int32Array(length + 1);
  nextClose.fill(-1);
  nextSpecial.fill(-1);
  nextBoundary.fill(-1);
  nextLineBreak.fill(-1);
  for (let index = length - 1; index >= 0; index--) {
    const character = source[index];
    const active = !escaped[index];
    const boundary = active &&
      (character === "<" || character === " " || character === "\t");
    nextClose[index] = active && character === ")"
      ? index
      : nextClose[index + 1];
    nextSpecial[index] = active &&
      (boundary || character === "(" || character === ")")
      ? index
      : nextSpecial[index + 1];
    nextBoundary[index] = boundary ? index : nextBoundary[index + 1];
    nextLineBreak[index] = character === "\n" || character === "\r"
      ? index
      : nextLineBreak[index + 1];
  }
  return { nextBoundary, nextClose, nextLineBreak, nextSpecial, parenEnd };
}

function markdownLinkDestinationEnd(source, start, scanIndex) {
  if (source[start] !== "(") return -1;
  const lineBreak = scanIndex.nextLineBreak[start + 1];
  const lineEnd = lineBreak < 0 ? source.length : lineBreak;
  const nextClose = scanIndex.nextClose[start + 1];
  if (nextClose < 0 || nextClose >= lineEnd) return -1;
  let cursor = start + 1;
  const skipSpace = () => {
    while (source[cursor] === " " || source[cursor] === "\t") cursor++;
  };
  skipSpace();

  if (source[cursor] === "<") {
    cursor++;
    let closed = false;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "\n" || character === "\r" || character === "<") {
        return -1;
      }
      if (character === "\\") {
        cursor += 2;
      } else if (character === ">") {
        cursor++;
        closed = true;
        break;
      } else {
        cursor++;
      }
    }
    if (!closed) return -1;
  } else {
    let depth = 0;
    while (cursor < lineEnd) {
      const special = scanIndex.nextSpecial[cursor];
      if (special < 0 || special >= lineEnd) return -1;
      cursor = special;
      const character = source[cursor];
      if (character === "<") return -1;
      if (character === "(") {
        const close = scanIndex.parenEnd[cursor];
        const boundary = scanIndex.nextBoundary[cursor + 1];
        if (
          close < 0 ||
          close >= lineEnd ||
          (boundary >= 0 && boundary < close)
        ) {
          return -1;
        }
        depth++;
        cursor = close + 1;
        depth--;
      } else if (character === ")") {
        if (depth === 0) return cursor + 1;
        depth--;
        cursor++;
      } else {
        break;
      }
    }
    if (depth !== 0) return -1;
  }

  const separatorStart = cursor;
  skipSpace();
  if (source[cursor] === ")") return cursor + 1;
  if (cursor === separatorStart) return -1;

  const opener = source[cursor];
  const closer = opener === '"'
    ? '"'
    : opener === "'"
      ? "'"
      : opener === "("
        ? ")"
        : "";
  if (!closer) return -1;
  cursor++;
  let titleClosed = false;
  while (cursor < source.length) {
    const character = source[cursor];
    if (character === "\n" || character === "\r") return -1;
    if (character === "\\") {
      cursor += 2;
    } else if (character === closer) {
      cursor++;
      titleClosed = true;
      break;
    } else {
      cursor++;
    }
  }
  if (!titleClosed) return -1;
  skipSpace();
  return source[cursor] === ")" ? cursor + 1 : -1;
}

function markdownReferenceSuffix(source, start) {
  if (source[start] !== "[") return;
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === "\n" || source[index] === "\r") return;
    if (source[index] === "\\") {
      index++;
    } else if (source[index] === "]") {
      return { end: index + 1, label: source.slice(start + 1, index) };
    } else if (source[index] === "[") {
      return;
    }
  }
}

function findMarkdownLinkContexts(source, referenceLabels = new Set()) {
  const text = String(source ?? "");
  const scanIndex = buildMarkdownLinkScanIndex(text);
  const contexts = [];
  const brackets = [];

  function supportedLabel(labelStart, labelEnd) {
    const label = text.slice(labelStart, labelEnd);
    const atomic = [];
    for (const match of findMathRanges(label)) {
      atomic.push({ start: match.index, end: match.end });
    }
    const revealPattern = /\[\[(.*?)\|\|(.*?)\]\]/g;
    let reveal;
    while ((reveal = revealPattern.exec(label))) {
      atomic.push({ start: reveal.index, end: reveal.index + reveal[0].length });
    }
    atomic.sort((left, right) => left.start - right.start || right.end - left.end);

    let atomicIndex = 0;
    let depth = 0;
    for (let index = 0; index < label.length; index++) {
      while (atomic[atomicIndex]?.end <= index) atomicIndex++;
      if (
        atomic[atomicIndex]?.start <= index &&
        index < atomic[atomicIndex]?.end
      ) {
        index = atomic[atomicIndex].end - 1;
        continue;
      }
      if (label[index] === "\\") {
        index++;
      } else if (label[index] === "[") {
        if (++depth > 1) return false;
      } else if (label[index] === "]") {
        if (depth-- <= 0) return false;
      }
    }
    return depth === 0;
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
    if (text.slice(Math.max(0, labelOpen - 6), labelOpen) === "!audio") {
      continue;
    }
    const image = labelOpen > 0 && text[labelOpen - 1] === "!" &&
      !escapedAt(text, labelOpen - 1);
    const ownerStart = image ? labelOpen - 1 : labelOpen;
    let end = markdownLinkDestinationEnd(text, index + 1, scanIndex);

    if (end < 0) {
      const reference = markdownReferenceSuffix(text, index + 1);
      if (reference) {
        const label = reference.label || text.slice(labelOpen + 1, index);
        if (referenceLabels.has(normalizeReferenceLabel(label))) {
          end = reference.end;
        }
      } else if (
        text[index + 1] !== ":" &&
        referenceLabels.has(
          normalizeReferenceLabel(text.slice(labelOpen + 1, index))
        )
      ) {
        end = index + 1;
      }
    }

    if (end >= 0 && supportedLabel(labelOpen + 1, index)) {
      contexts.push({
        kind: "link",
        start: ownerStart,
        end,
        labelStart: labelOpen + 1,
        labelEnd: index,
        image
      });
      // A parsed destination/title is owned by this link and cannot contain a
      // second Markdown link. Skip it instead of reconsidering every bracket
      // inside a long or deeply parenthesized URL.
      index = end - 1;
    }
  }
  return contexts.sort(
    (left, right) => left.start - right.start || right.end - left.end
  );
}

function findQuizifyAudioRanges(source) {
  const text = String(source ?? "");
  const ranges = [];
  let lineStart = 0;
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    if (lineEnd > lineStart && text[lineEnd - 1] === "\r") lineEnd--;

    let start = text.indexOf("!audio[", lineStart);
    while (start >= 0 && start < lineEnd) {
      const labelEnd = text.indexOf("](", start + 7);
      // Keep this scanner equivalent to the extension's non-dotAll pattern,
      // but never retry every later opener against the same failed suffix.
      if (labelEnd < 0 || labelEnd >= lineEnd) break;
      const end = text.indexOf(")", labelEnd + 2);
      if (end < 0 || end >= lineEnd) break;
      ranges.push({ start, end: end + 1 });
      start = text.indexOf("!audio[", end + 1);
    }

    if (lineEnd === text.length) break;
    lineStart = lineEnd + (text[lineEnd] === "\r" ? 2 : 1);
  }
  return ranges;
}

function resolveInlineOwnership(
  source,
  extraOpaqueRanges = [],
  referenceLabels = new Set(),
  includeLinks = true
) {
  const text = String(source ?? "");
  const hasMath = findPotentialMathDelimiterStart(text) !== undefined;
  const mathIndex = hasMath ? buildMathSearchIndex(text, KATEX_DELIMITERS) : null;
  const backticks = text.includes("`") ? buildBacktickRunIndex(text) : null;
  const linkContexts = includeLinks
    ? findMarkdownLinkContexts(text, referenceLabels)
    : [];
  const opaqueRanges = extraOpaqueRanges
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const activeMath = [];
  const activeCode = [];
  const activeOpaque = [];
  const active = [];
  let opaqueIndex = 0;
  let codeRunIndex = 0;
  let linkIndex = 0;
  let cursor = 0;
  let cachedMath;
  let mathSearchExhausted = false;

  function appendRange(range) {
    active.push(range);
    if (range.kind === "math") activeMath.push(range);
    else if (range.kind === "code") activeCode.push(range);
    else activeOpaque.push(range);
  }

  while (cursor < text.length) {
    while (opaqueRanges[opaqueIndex]?.start < cursor) opaqueIndex++;
    while (linkContexts[linkIndex]?.start < cursor) linkIndex++;
    if (cachedMath?.index < cursor) cachedMath = undefined;
    if (mathIndex && !cachedMath && !mathSearchExhausted) {
      const mathStart = indexedMathDelimiterStart(
        text,
        KATEX_DELIMITERS,
        cursor,
        mathIndex
      );
      if (mathStart === undefined) {
        mathSearchExhausted = true;
      } else {
        cachedMath = matchMathDelimiterAt(
          text,
          mathStart,
          KATEX_DELIMITERS,
          mathIndex.htmlIndex
        );
      }
    }
    const math = cachedMath;
    while (backticks?.runs[codeRunIndex]?.openerStart < cursor) codeRunIndex++;
    const code = backticks
      ? nextInlineCodeRange(backticks, cursor, codeRunIndex)
      : undefined;
    const opaque = opaqueRanges[opaqueIndex];
    const link = linkContexts[linkIndex];
    const candidates = [
      math && { kind: "math", start: math.index, end: math.end, match: math },
      code && { kind: "code", start: code.start, end: code.end },
      opaque && { kind: "opaque", start: opaque.start, end: opaque.end },
      link
    ].filter(Boolean);
    if (!candidates.length) break;
    candidates.sort((left, right) => left.start - right.start);
    const range = candidates[0];

    if (range.kind === "link") {
      if (range.image) {
        appendRange({ kind: "opaque", start: range.start, end: range.end });
      } else {
        appendRange({
          kind: "opaque",
          start: range.start,
          end: range.labelStart
        });
        const label = text.slice(range.labelStart, range.labelEnd);
        const nested = resolveInlineOwnership(
          label,
          findHtmlOpaqueRanges(label),
          new Set(),
          false
        );
        for (const child of nested.active) {
          appendRange({
            ...child,
            blockEligible: child.kind === "math" ? false : child.blockEligible,
            start: child.start + range.labelStart,
            end: child.end + range.labelStart,
            match: child.match && {
              ...child.match,
              index: child.match.index + range.labelStart,
              end: child.match.end + range.labelStart
            }
          });
        }
        appendRange({
          kind: "opaque",
          start: range.labelEnd,
          end: range.end
        });
      }
      linkIndex++;
    } else if (range.kind === "code") {
      appendRange(range);
      codeRunIndex = code.closerIndex + 1;
    } else {
      appendRange(range);
      if (range.kind === "opaque") opaqueIndex++;
    }
    cursor = range.end;
    if (range.kind === "math") cachedMath = undefined;
  }

  return {
    active,
    math: activeMath,
    code: activeCode,
    opaque: activeOpaque
  };
}

function resolveInlineMathAndCodeRanges(source) {
  const text = String(source ?? "");
  return resolveInlineOwnership(
    text,
    findHtmlOpaqueRanges(text),
    collectMarkdownReferenceLabels(text)
  );
}

function maskRanges(source, ranges, replacement) {
  const text = String(source ?? "");
  const fill = String(replacement || "x")[0];
  const masked = [];
  let offset = 0;
  for (const range of ranges) {
    masked.push(text.slice(offset, range.start));
    masked.push(text.slice(range.start, range.end).replace(/[^\r\n]/g, fill));
    offset = range.end;
  }
  masked.push(text.slice(offset));
  return masked.join("");
}

function protectMathPipesInLine(text, marker, referenceLabels) {
  const htmlIndex = buildHtmlTagEndIndex(text);
  const ownership = resolveInlineOwnership(
    text,
    [
      ...findHtmlOpaqueRanges(text, htmlIndex),
      ...findQuizifyAudioRanges(text)
    ],
    referenceLabels
  );

  let protectedSource = "";
  let cursor = 0;
  for (const range of ownership.active) {
    protectedSource += text.slice(cursor, range.start);
    const value = text.slice(range.start, range.end);
    protectedSource += range.kind === "math"
      ? value.replace(/\|/g, marker)
      : value;
    cursor = range.end;
  }
  return protectedSource + text.slice(cursor);
}

function unusedPrivateMarker(text) {
  const first = 0xe000;
  const size = 0xf8ff - first + 1;
  const usedPairs = new Set();

  function recordPair(leftCode, rightCode) {
    const left = leftCode - first;
    const right = rightCode - first;
    if (left >= 0 && left < size && right >= 0 && right < size) {
      usedPairs.add(left * size + right);
    }
  }

  for (let index = 1; index < text.length; index++) {
    recordPair(text.charCodeAt(index - 1), text.charCodeAt(index));
  }

  function hexNibble(code) {
    if (code >= 48 && code <= 57) return code - 48;
    const folded = code | 32;
    return folded >= 97 && folded <= 102 ? folded - 87 : -1;
  }

  function percentByteAt(index) {
    if (text.charCodeAt(index) !== 37) return -1;
    const high = hexNibble(text.charCodeAt(index + 1));
    const low = hexNibble(text.charCodeAt(index + 2));
    return high < 0 || low < 0 ? -1 : high * 16 + low;
  }

  function encodedPuaAt(index) {
    const firstByte = percentByteAt(index);
    const secondByte = percentByteAt(index + 3);
    const thirdByte = percentByteAt(index + 6);
    if (
      firstByte < 0xe0 || firstByte > 0xef ||
      secondByte < 0x80 || secondByte > 0xbf ||
      thirdByte < 0x80 || thirdByte > 0xbf
    ) {
      return -1;
    }
    const code = ((firstByte & 0x0f) << 12) |
      ((secondByte & 0x3f) << 6) |
      (thirdByte & 0x3f);
    return code >= first && code < first + size ? code : -1;
  }

  // Marked percent-encodes private-use characters in autolinks and URLs. Treat
  // adjacent encoded PUA characters as occupied too. The fixed-width decoder
  // avoids regex/backtracking and exception-heavy decodeURIComponent calls.
  let previousCode = -1;
  let previousEnd = -1;
  let percent = text.indexOf("%");
  while (percent >= 0) {
    const code = encodedPuaAt(percent);
    if (code >= 0) {
      if (previousEnd === percent) recordPair(previousCode, code);
      previousCode = code;
      previousEnd = percent + 9;
      percent = text.indexOf("%", previousEnd);
    } else {
      percent = text.indexOf("%", percent + 1);
    }
  }

  for (
    let candidate = 0;
    candidate < size * size && candidate <= usedPairs.size;
    candidate++
  ) {
    if (!usedPairs.has(candidate)) {
      return String.fromCharCode(
        first + Math.floor(candidate / size),
        first + (candidate % size)
      );
    }
  }

  // A JavaScript string cannot contain every two-code-unit PUA pair without
  // already exceeding practical field limits, but fail closed if that invariant
  // ever changes instead of silently substituting the string "undefined".
  throw new Error(t("math.marker_unavailable"));
}

export function protectMathPipes(source) {
  const text = String(source ?? "");
  const marker = unusedPrivateMarker(text);
  const referenceLabels = collectMarkdownReferenceLabels(text);

  // GFM splits table cells before Marked runs inline extensions and removes
  // the escape from \|. Temporarily make formula pipes opaque at that earlier
  // stage, then restore them in the rendered HTML before sanitization. Table
  // cells are single-line, so keeping scans line-local also prevents a
  // malformed opener from pairing with a delimiter on a later line. Applying
  // the same reversible marker inside block code is harmless (Marked owns that
  // block and restore() puts the pipe back), and avoids relying on a second,
  // subtly different implementation of Markdown container scoping.
  const protectedSource = text
    .split(/(\r\n|\r|\n)/)
    .map((part, index) =>
      (index % 2 === 0 && part.includes("|")
        ? protectMathPipesInLine(part, marker, referenceLabels)
        : part)
    )
    .join("");

  return {
    source: protectedSource,
    restore(value) {
      const encoded = encodeURIComponent(marker);
      return String(value ?? "")
        .split(marker)
        .join("|")
        .replace(new RegExp(encoded, "gi"), "|");
    }
  };
}

function rawHtmlBlockStart(line, allowTypeSeven = true) {
  const content = String(line ?? "").replace(/^ {0,3}/, "");
  if (content.startsWith("<!--")) return { type: "until", value: "-->" };
  if (content.startsWith("<?")) return { type: "until", value: "?>" };
  if (content.startsWith("<![CDATA[")) return { type: "until", value: "]]>" };
  if (/^<![A-Za-z]/.test(content)) return { type: "until", value: ">" };

  const raw = /^<(pre|script|style|textarea)(?=[\s>]|$)/i.exec(content);
  if (raw) return { type: "closing", value: raw[1].toLowerCase() };

  const block = /^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/i.exec(content);
  if (block && MARKDOWN_HTML_BLOCK_TAGS.has(block[1].toLowerCase())) {
    return { type: "blank" };
  }

  if (
    allowTypeSeven &&
    /^(?:<\/?[A-Za-z][\w-]*(?:\s+[A-Za-z:_][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>)\s*$/.test(
      content
    )
  ) {
    return { type: "blank" };
  }
}

function rawHtmlBlockEnds(line, state) {
  if (!state) return true;
  if (state.type === "blank") return /^\s*$/.test(line);
  if (state.type === "closing") {
    return new RegExp(`</${state.value}\\s*>`, "i").test(line);
  }
  return String(line).includes(state.value);
}

function classifyMarkdownBlockLines(source) {
  const text = String(source ?? "");
  const parts = text.split(/(\r\n|\r|\n)/);
  const lines = [];
  let offset = 0;
  let fence = null;
  let mathEnd = -1;
  let rawHtml = null;
  let previousBlank = true;
  let blockMathIndex = null;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const newline = parts[index + 1] || "";
    const start = offset;
    offset += line.length + newline.length;
    let kind = "plain";

    if (start < mathEnd) {
      kind = "math";
    } else if (fence) {
      kind = "fence";
      fence = nextFence(line, fence);
    } else if (rawHtml) {
      kind = "html";
      if (rawHtmlBlockEnds(line, rawHtml)) rawHtml = null;
    } else {
      const opener = /^( {0,3})(?=\$\$|\\\[)/.exec(line);
      if (opener && !blockMathIndex) {
        blockMathIndex = buildMathSearchIndex(text, KATEX_BLOCK_DELIMITERS);
      }
      const math = opener
        ? indexedMathDelimiterMatchAt(
            text,
            start + opener[1].length,
            KATEX_BLOCK_DELIMITERS,
            blockMathIndex
          )
        : undefined;
      if (math) {
        kind = "math";
        mathEnd = math.end;
      } else {
        const html = rawHtmlBlockStart(line, previousBlank);
        if (html) {
          kind = "html";
          if (!rawHtmlBlockEnds(line, html)) rawHtml = html;
        } else {
          const next = nextFence(line, null);
          if (next) {
            kind = "fence";
            fence = next;
          }
        }
      }
    }

    lines.push({ line, newline, start, kind });
    previousBlank = /^\s*$/.test(line);
  }
  return lines;
}

export function maskMarkdownFencedCode(source) {
  const text = String(source ?? "");
  const lines = classifyMarkdownBlockLines(text).map((line, index) => ({
    ...line,
    content: line.line,
    originalIndex: index
  }));
  const masked = new Set();
  const blocked = new Set(
    lines
      .filter(({ kind }) => kind === "math" || kind === "html")
      .map(({ originalIndex }) => originalIndex)
  );

  // The block classifier handles top-level HTML ownership. Add the shared
  // inline/block math ownership as well because list/blockquote prefixes are
  // stripped by Marked before their nested lexer sees display math.
  const mathRanges = resolveInlineMathAndCodeRanges(text).math;
  let rangeIndex = 0;
  for (const line of lines) {
    const end = line.start + line.line.length + line.newline.length;
    while (mathRanges[rangeIndex]?.end <= line.start) rangeIndex++;
    if (
      mathRanges[rangeIndex]?.start < end &&
      mathRanges[rangeIndex]?.end > line.start
    ) {
      blocked.add(line.originalIndex);
    }
  }

  function stripIndent(value, columns) {
    let column = 0;
    let index = 0;
    while (index < value.length && column < columns) {
      if (value[index] === " ") {
        column++;
      } else if (value[index] === "\t") {
        column += 4 - (column % 4);
      } else {
        break;
      }
      index++;
    }
    return column >= columns ? value.slice(index) : undefined;
  }

  function listItemProjection(view, index) {
    const match = /^( {0,3})([*+-]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(
      view[index].content
    );
    if (!match) return;
    const markerWidth = match[1].length + match[2].length;
    let gapWidth = 0;
    for (const character of match[3]) {
      gapWidth += character === "\t"
        ? 4 - ((markerWidth + gapWidth) % 4)
        : 1;
    }
    const contentIndent = markerWidth + (gapWidth <= 4 ? gapWidth : 1);
    const firstContent = gapWidth <= 4
      ? match[4]
      : match[3].slice(1) + match[4];
    const child = [{ ...view[index], content: firstContent }];
    let cursor = index + 1;

    while (cursor < view.length) {
      const value = view[cursor].content;
      if (/^[ \t]*$/.test(value)) {
        child.push({ ...view[cursor], content: "" });
        cursor++;
        continue;
      }
      const projected = stripIndent(value, contentIndent);
      if (projected === undefined) break;
      child.push({ ...view[cursor], content: projected });
      cursor++;
    }
    return { child, end: cursor };
  }

  function maskScope(view, depth = 0) {
    if (depth > 16) return;
    let index = 0;
    let previousBlank = true;

    while (index < view.length) {
      const entry = view[index];
      const content = entry.content;
      if (blocked.has(entry.originalIndex)) {
        previousBlank = /^[ \t]*$/.test(content);
        index++;
        continue;
      }

      const quote = /^ {0,3}>[ \t]?/.exec(content);
      if (quote) {
        const child = [];
        let cursor = index;
        while (cursor < view.length) {
          const prefix = /^ {0,3}>[ \t]?/.exec(view[cursor].content);
          if (!prefix) break;
          child.push({
            ...view[cursor],
            content: view[cursor].content.slice(prefix[0].length)
          });
          cursor++;
        }
        maskScope(child, depth + 1);
        previousBlank = false;
        index = cursor;
        continue;
      }

      const list = listItemProjection(view, index);
      if (list) {
        maskScope(list.child, depth + 1);
        previousBlank = false;
        index = list.end;
        continue;
      }

      const opener = nextFence(content, null);
      if (opener) {
        let closer = index + 1;
        while (
          closer < view.length &&
          (
            blocked.has(view[closer].originalIndex) ||
            nextFence(view[closer].content, opener) !== null
          )
        ) {
          closer++;
        }
        if (closer < view.length) {
          for (let line = index; line <= closer; line++) {
            masked.add(view[line].originalIndex);
          }
          index = closer + 1;
          previousBlank = false;
          continue;
        }
        // An unclosed fence owns only the remainder of its current container
        // scope. In a list/blockquote recursion that scope ends at the outdent,
        // so it cannot hide otherwise valid syntax later in the document.
        for (let line = index; line < view.length; line++) {
          masked.add(view[line].originalIndex);
        }
        return;
      }

      if (
        previousBlank &&
        (/^ {4}/.test(content) || content.startsWith("\t"))
      ) {
        let cursor = index;
        while (cursor < view.length) {
          const value = view[cursor].content;
          if (/^[ \t]*$/.test(value)) {
            cursor++;
            continue;
          }
          if (!/^ {4}/.test(value) && !value.startsWith("\t")) break;
          masked.add(view[cursor].originalIndex);
          cursor++;
        }
        index = cursor;
        previousBlank = true;
        continue;
      }

      previousBlank = /^[ \t]*$/.test(content);
      index++;
    }
  }

  maskScope(lines);

  return lines
    .map(({ line, newline }, lineIndex) =>
      (masked.has(lineIndex) ? " ".repeat(line.length) : line) + newline
    )
    .join("");
}

function maskHtmlMathContexts(source) {
  const text = String(source ?? "");
  const htmlIndex = buildHtmlTagEndIndex(text);
  const masked = [];
  let cursor = 0;
  let plainStart = 0;
  while (cursor < text.length) {
    if (text[cursor] !== "<") {
      cursor++;
      continue;
    }
    const ignoredEnd = closingHtmlCodeTag(text, cursor, htmlIndex);
    const markupEnd = ignoredEnd >= 0
      ? ignoredEnd
      : htmlBoundaryAt(text, cursor, htmlIndex);
    if (markupEnd < 0) {
      cursor++;
      continue;
    }
    masked.push(text.slice(plainStart, cursor));
    masked.push(text.slice(cursor, markupEnd).replace(/[^\r\n]/g, " "));
    cursor = markupEnd;
    plainStart = cursor;
  }
  masked.push(text.slice(plainStart));
  return masked.join("");
}

export function maskMath(source, replacement = "x") {
  const text = String(source ?? "");
  return maskRanges(
    text,
    resolveInlineMathAndCodeRanges(text).math,
    replacement
  );
}

export function maskMarkdownInlineContexts(source, replacement = "x") {
  const text = String(source ?? "");
  const protectedText = maskRanges(
    text,
    resolveInlineMathAndCodeRanges(text).active,
    replacement
  );
  return maskHtmlMathContexts(protectedText);
}

const MUTATING_TEX_COMMANDS = new Set([
  "DeclareMathOperator",
  "catcode",
  "def",
  "edef",
  "futurelet",
  "gdef",
  "global",
  "let",
  "newcommand",
  "providecommand",
  "renewcommand",
  "xdef"
]);

function hasMutatingTexCommand(source) {
  const text = String(source ?? "");
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "%") {
      while (index < text.length && text[index] !== "\n" && text[index] !== "\r") {
        index++;
      }
      continue;
    }
    if (text[index] !== "\\") continue;
    const commandStart = index + 1;
    const first = text[commandStart];
    if (!/[A-Za-z]/.test(first || "")) {
      // A TeX control symbol consumes exactly one non-letter. In particular,
      // `\\\\def` is a line-break command followed by ordinary text, not \def.
      index = commandStart;
      continue;
    }
    let end = commandStart + 1;
    while (/[A-Za-z]/.test(text[end] || "")) end++;
    if (MUTATING_TEX_COMMANDS.has(text.slice(commandStart, end))) return true;
    index = end - 1;
  }
  return false;
}

export function renderMathPlaceholders(root, katexApi) {
  if (!root?.querySelectorAll || typeof katexApi?.render !== "function") return 0;

  // Markdown output is sanitized before this function runs. Rendering only
  // lexer-created placeholders avoids re-scanning ordinary text (notably \$)
  // while preserving KaTeX's required inline layout styles.
  let rendered = 0;
  let seen = 0;
  let totalSourceLength = 0;
  root.querySelectorAll(MATH_PLACEHOLDER_SELECTOR).forEach((element) => {
    const source = element.textContent || "";
    const left = element.getAttribute("data-quizify-math-left") || "";
    const right = element.getAttribute("data-quizify-math-right") || "";
    if (element.closest(KATEX_IGNORED_ANCESTORS)) {
      element.replaceWith(
        element.ownerDocument.createTextNode(`${left}${source}${right}`)
      );
      return;
    }

    if (
      !["SPAN", "DIV"].includes(element.tagName) ||
      !element.classList.contains(MATH_PLACEHOLDER_CLASS)
    ) {
      return;
    }

    seen++;
    totalSourceLength += source.length;
    if (
      seen > MAX_MATH_EXPRESSIONS ||
      source.length > MAX_TEX_SOURCE_LENGTH ||
      totalSourceLength > MAX_TOTAL_TEX_SOURCE_LENGTH ||
      hasMutatingTexCommand(source)
    ) {
      element.textContent = `${left}${source}${right}`;
      element.removeAttribute("data-quizify-math");
      element.removeAttribute("data-quizify-math-left");
      element.removeAttribute("data-quizify-math-right");
      element.classList.add("quizify-math-error");
      element.setAttribute(
        "title",
        hasMutatingTexCommand(source)
          ? `KaTeX: ${t("math.macros_disabled")}`
          : `KaTeX: ${t("math.render_budget_exceeded")}`
      );
      return;
    }

    const displayMode = element.getAttribute("data-quizify-math") === "display";
    try {
      katexApi.render(source, element, {
        displayMode,
        maxExpand: 100,
        maxSize: 100,
        // Never share mutable macro state between formulas. Combined with the
        // definition preflight, this prevents small TeX inputs from expanding
        // into an unbounded DOM or changing later formulas.
        macros: {},
        trust: false,
        throwOnError: false
      });
      element.removeAttribute("data-quizify-math");
      element.removeAttribute("data-quizify-math-left");
      element.removeAttribute("data-quizify-math-right");
      element.classList.add("quizify-math-rendered");
      rendered++;
    } catch {
      element.textContent = `${left}${source}${right}`;
      element.removeAttribute("data-quizify-math");
      element.removeAttribute("data-quizify-math-left");
      element.removeAttribute("data-quizify-math-right");
      element.classList.add("quizify-math-error");
      element.setAttribute("title", `KaTeX: ${t("math.render_failed")}`);
    }
  });
  return rendered;
}
