import { hljs } from "./dependencies.js";

function splitNode(node) {
  if (node.nodeType === 3) {
    return String(node.nodeValue ?? "")
      .split("\n")
      .map((value) => node.ownerDocument.createTextNode(value));
  }
  if (node.nodeType !== 1) return [node.cloneNode(true)];

  const lines = [node.cloneNode(false)];
  for (const child of node.childNodes) {
    const childLines = splitNode(child);
    lines[lines.length - 1].appendChild(childLines[0]);
    for (const continuation of childLines.slice(1)) {
      const next = node.cloneNode(false);
      next.appendChild(continuation);
      lines.push(next);
    }
  }
  return lines;
}

function splitContents(element) {
  const lines = [element.ownerDocument.createDocumentFragment()];
  for (const child of Array.from(element.childNodes)) {
    const childLines = splitNode(child);
    lines[lines.length - 1].appendChild(childLines[0]);
    for (const continuation of childLines.slice(1)) {
      const fragment = element.ownerDocument.createDocumentFragment();
      fragment.appendChild(continuation);
      lines.push(fragment);
    }
  }
  return lines;
}

export function highlightCodeElement(code) {
  if (code.dataset.quizifyHighlighted === "true") return;
  hljs.highlightElement(code);
  const lines = splitContents(code);
  code.replaceChildren();
  code.classList.add("quizify-code-lines");
  lines.forEach((line, index) => {
    const row = code.ownerDocument.createElement("span");
    row.className = "quizify-code-line";
    row.dataset.lineNumber = String(index + 1);
    row.appendChild(line);
    if (!row.textContent) row.appendChild(code.ownerDocument.createTextNode(" "));
    code.appendChild(row);
  });
  code.dataset.quizifyHighlighted = "true";
}
