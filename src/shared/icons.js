import {
  AudioLines,
  BadgeAlert,
  Bold,
  BookOpenCheck,
  Braces,
  Check,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleX,
  Code,
  CodeXml,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Focus,
  Heading1,
  Highlighter,
  Image,
  Info,
  Italic,
  Lightbulb,
  Link,
  List,
  ListChecks,
  ListCollapse,
  ListOrdered,
  LoaderCircle,
  MessageSquareText,
  MessageSquareWarning,
  Move,
  PanelsTopLeft,
  Pause,
  Play,
  Quote,
  RotateCcw,
  ScanEye,
  ShieldAlert,
  Shuffle,
  SquareCode,
  Strikethrough,
  Subscript,
  Superscript,
  Table,
  TextCursorInput,
  TriangleAlert,
  X
} from "lucide";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ROOT_ATTRIBUTES = Object.freeze({
  xmlns: SVG_NAMESPACE,
  width: "24",
  height: "24",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
  focusable: "false"
});

const ICON_NODES = Object.freeze({
  bold: Bold,
  italic: Italic,
  strikethrough: Strikethrough,
  "code-inline": Code,
  "inline-code": CodeXml,
  "code-block": SquareCode,
  link: Link,
  "heading-1": Heading1,
  quote: Quote,
  blockquote: Quote,
  highlight: Highlighter,
  superscript: Superscript,
  subscript: Subscript,
  alert: TriangleAlert,
  "github-alert": MessageSquareWarning,
  list: List,
  "unordered-list": List,
  "list-ordered": ListOrdered,
  "ordered-list": ListOrdered,
  image: Image,
  table: Table,
  fitb: TextCursorInput,
  choice: ListChecks,
  reveal: Eye,
  "reveal-card": CircleHelp,
  annotation: MessageSquareText,
  collapse: ListCollapse,
  tabs: PanelsTopLeft,
  audio: AudioLines,
  recite: BookOpenCheck,
  preview: ScanEye,
  "status-ok": CircleCheck,
  "status-warning": CircleAlert,
  "status-error": CircleX,
  replay: RotateCcw,
  "rotate-ccw": RotateCcw,
  play: Play,
  pause: Pause,
  cancel: X,
  x: X,
  shuffle: Shuffle,
  info: Info,
  tip: Lightbulb,
  lightbulb: Lightbulb,
  important: BadgeAlert,
  caution: ShieldAlert,
  flip: FlipHorizontal2,
  "flip-horizontal-2": FlipHorizontal2,
  move: Move,
  loading: LoaderCircle,
  loader: LoaderCircle,
  focus: Focus,
  check: Check,
  eye: Eye,
  "eye-off": EyeOff,
  "circle-alert": CircleAlert,
  "triangle-alert": TriangleAlert,
  "chevron-down": ChevronDown,
  "check-square": CheckSquare,
  "panels-top-left": PanelsTopLeft,
  braces: Braces,
  "circle-dot": CircleDot,
  code: Code
});

// The mark is original to Quizify: a Q-shaped study loop containing a small
// completion tick. It intentionally uses geometry only, so it remains stable
// across platforms and writing systems.
const BRAND_NODES = Object.freeze([
  ["circle", Object.freeze({ cx: "11", cy: "11", r: "7.5" })],
  ["path", Object.freeze({ d: "m16.3 16.3 4.7 4.7" })],
  ["path", Object.freeze({ d: "m7.7 11.2 2.2 2.2 4.5-4.7" })]
]);

const SAFE_ELEMENT_NAMES = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect"
]);

const SAFE_NODE_ATTRIBUTES = new Set([
  "cx",
  "cy",
  "d",
  "height",
  "points",
  "r",
  "rx",
  "ry",
  "width",
  "x",
  "x1",
  "x2",
  "y",
  "y1",
  "y2"
]);

function normalizeClassName(className) {
  if (className === undefined || className === null || className === "") return "";
  if (typeof className !== "string") {
    throw new TypeError("Icon className must be a string.");
  }
  const tokens = className.trim().split(/\s+/).filter(Boolean);
  if (
    tokens.some(
      (token) => !/^-?[_A-Za-z][_A-Za-z0-9-]*$/.test(token)
    )
  ) {
    throw new TypeError("Icon className contains an unsafe CSS class token.");
  }
  return tokens.join(" ");
}

function getIconNodes(name) {
  if (
    typeof name !== "string" ||
    !Object.prototype.hasOwnProperty.call(ICON_NODES, name)
  ) {
    throw new RangeError(`Unknown Quizify icon: ${String(name)}`);
  }
  return ICON_NODES[name];
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function checkedNode(node) {
  if (!Array.isArray(node) || node.length !== 2) {
    throw new TypeError("Invalid icon node.");
  }
  const [tagName, attributes] = node;
  if (!SAFE_ELEMENT_NAMES.has(tagName) || !attributes || typeof attributes !== "object") {
    throw new TypeError("Invalid icon node.");
  }
  for (const attributeName of Object.keys(attributes)) {
    if (!SAFE_NODE_ATTRIBUTES.has(attributeName)) {
      throw new TypeError(`Unsafe icon attribute: ${attributeName}`);
    }
  }
  return [tagName, attributes];
}

function rootAttributes(className) {
  const normalizedClassName = normalizeClassName(className);
  return normalizedClassName
    ? { ...ROOT_ATTRIBUTES, class: normalizedClassName }
    : ROOT_ATTRIBUTES;
}

function serializeAttributes(attributes) {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");
}

function serializeNodes(nodes) {
  return nodes
    .map((node) => {
      const [tagName, attributes] = checkedNode(node);
      return `<${tagName} ${serializeAttributes(attributes)}></${tagName}>`;
    })
    .join("");
}

function svgFromNodes(nodes, className) {
  return `<svg ${serializeAttributes(rootAttributes(className))}>${serializeNodes(nodes)}</svg>`;
}

function elementFromNodes(document, nodes, className) {
  if (
    !document ||
    (typeof document.createElementNS !== "function" &&
      typeof document.createElement !== "function")
  ) {
    throw new TypeError("A DOM document with an element factory is required.");
  }
  const usesNamespaceFactory = typeof document.createElementNS === "function";
  const createElement = usesNamespaceFactory
    ? (tagName) => document.createElementNS(SVG_NAMESPACE, tagName)
    : (tagName) => document.createElement(tagName);
  const svg = createElement("svg");
  const attributes = rootAttributes(className);
  for (const [name, value] of Object.entries(attributes)) {
    svg.setAttribute(name, value);
  }
  if (!usesNamespaceFactory && attributes.class && typeof svg.className === "string") {
    svg.className = attributes.class;
  }
  for (const node of nodes) {
    const [tagName, attributes] = checkedNode(node);
    const child = createElement(tagName);
    for (const [name, value] of Object.entries(attributes)) {
      child.setAttribute(name, value);
    }
    if (typeof svg.append === "function") svg.append(child);
    else svg.appendChild(child);
  }
  return svg;
}

export function iconSvg(name, { className } = {}) {
  return svgFromNodes(getIconNodes(name), className);
}

export function createIconElement(document, name, { className } = {}) {
  return elementFromNodes(document, getIconNodes(name), className);
}

export function brandMarkSvg({ className } = {}) {
  return svgFromNodes(BRAND_NODES, className);
}

export function createBrandMarkElement(document, { className } = {}) {
  return elementFromNodes(document, BRAND_NODES, className);
}
