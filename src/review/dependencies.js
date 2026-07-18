import * as markedApi from "marked";
import hljs from "highlight.js/lib/common";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";

globalThis.marked = markedApi;
globalThis.hljs = hljs;
globalThis.katex = katex;
globalThis.renderMathInElement = renderMathInElement;

export { markedApi, hljs, katex, renderMathInElement };
