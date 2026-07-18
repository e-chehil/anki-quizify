import { build } from "esbuild";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const unknownArgs = [...args].filter((arg) => arg !== "--release");
if (unknownArgs.length) {
  throw new Error(`Unknown build option: ${unknownArgs.join(", ")}`);
}
const release = args.has("--release");
const addon = path.join(root, "quizify_addon");
const web = path.join(addon, "web");
const licenses = path.join(addon, "licenses");
await mkdir(web, { recursive: true });
await mkdir(licenses, { recursive: true });
await copyFile(
  path.join(root, "THIRD_PARTY_LICENSES.md"),
  path.join(addon, "THIRD_PARTY_LICENSES.md")
);
for (const [source, target] of [
  ["marked/LICENSE", "marked-LICENSE.txt"],
  ["katex/LICENSE", "katex-LICENSE.txt"],
  ["highlight.js/LICENSE", "highlight.js-LICENSE.txt"],
  ["dompurify/LICENSE", "DOMPurify-Apache-LICENSE.txt"],
  ["dompurify/LICENSE-MPL", "DOMPurify-MPL-LICENSE.txt"]
]) {
  await copyFile(path.join(root, "node_modules", source), path.join(licenses, target));
}

const common = {
  absWorkingDir: root,
  bundle: true,
  minify: release,
  sourcemap: false,
  target: ["es2019"],
  logLevel: "info",
  legalComments: "eof"
};

const katexWoff2Only = {
  name: "katex-woff2-only",
  setup(context) {
    context.onLoad({ filter: /katex\.min\.css$/ }, async ({ path: cssPath }) => {
      const original = await readFile(cssPath, "utf8");
      const contents = original.replace(/src:[^}]+/g, (source) => {
        const woff2 = source.match(/url\([^)]*\.woff2\)\s*format\("woff2"\)/);
        return woff2 ? `src:${woff2[0]}` : source;
      });
      return { contents, loader: "css", resolveDir: path.dirname(cssPath) };
    });
  }
};

for (const name of await readdir(addon)) {
  if (/^_quizify-katex-/.test(name)) {
    await rm(path.join(addon, name), { force: true });
  }
}

await build({
  ...common,
  entryPoints: [path.join(root, "src/review/entry.js")],
  outfile: path.join(addon, "_quizify.js"),
  format: "iife",
  footer: {
    js: "if (typeof module === 'object' && module.exports) module.exports = globalThis.myquizify;"
  }
});

await build({
  ...common,
  entryPoints: [path.join(root, "src/review/bundle.css")],
  outfile: path.join(addon, "_quizify.css"),
  loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
  assetNames: "_quizify-katex-[name]-[hash]",
  plugins: [katexWoff2Only]
});

const bundledReviewCss = await readFile(path.join(addon, "_quizify.css"), "utf8");

await build({
  ...common,
  entryPoints: [path.join(root, "src/editor/entry.js")],
  outfile: path.join(web, "editor.js"),
  format: "iife"
});

await build({
  ...common,
  entryPoints: [path.join(root, "src/editor/preview-entry.js")],
  outfile: path.join(web, "editor-preview.js"),
  format: "iife",
  define: {
    __QUIZIFY_REVIEW_CSS__: JSON.stringify(bundledReviewCss)
  }
});

await build({
  ...common,
  entryPoints: [path.join(root, "src/shared/syntax-tools.js")],
  outfile: path.join(web, "syntax-tools.js"),
  format: "iife",
  footer: {
    js: "if (typeof module === 'object' && module.exports) module.exports = globalThis.QuizifySyntax;"
  }
});

await build({
  ...common,
  entryPoints: [path.join(root, "src/editor/styles.css")],
  outfile: path.join(web, "editor.css")
});

const mediaNames = (await readdir(addon)).filter((name) => /^_quizify(?:-katex-.*\.(?:woff2?|ttf)|\.(?:js|css))$/.test(name));
mediaNames.push("_persistence.js");
const files = {};
for (const name of mediaNames.sort()) {
  const data = await readFile(path.join(addon, name));
  files[name] = {
    bytes: data.byteLength,
    sha256: createHash("sha256").update(data).digest("hex")
  };
}
await writeFile(
  path.join(addon, "media-manifest.json"),
  `${JSON.stringify({ schema_version: 1, files }, null, 2)}\n`,
  "utf8"
);
