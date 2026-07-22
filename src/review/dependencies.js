import * as markedApi from "marked";
import hljs from "highlight.js/lib/common";
import katex from "katex";

globalThis.marked = markedApi;
globalThis.hljs = hljs;
globalThis.katex = katex;

export { markedApi, hljs, katex };
