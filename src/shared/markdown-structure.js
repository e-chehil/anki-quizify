export function fenceMarker(line) {
  const match = /^(?: {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(
    String(line ?? "")
  );
  if (!match || (match[1][0] === "`" && match[2].includes("`"))) {
    return null;
  }
  return { char: match[1][0], length: match[1].length };
}

export function closesFence(line, fence) {
  if (!fence) return false;
  const match = /^(?: {0,3})(`{3,}|~{3,})\s*$/.exec(String(line ?? ""));
  return Boolean(
    match && match[1][0] === fence.char && match[1].length >= fence.length
  );
}

export function nextFence(line, fence) {
  if (fence) return closesFence(line, fence) ? null : fence;
  return fenceMarker(line);
}

export function uniqueSortedLetters(value) {
  return Array.from(new Set(String(value || "").toUpperCase().split("")))
    .filter((letter) => /^[A-Z]$/.test(letter))
    .sort()
    .join("");
}
