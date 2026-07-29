import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../quizify_addon/", import.meta.url);

test("templates are offline-only and use the v1 boot API", async () => {
  for (const name of ["front.html", "back.html"]) {
    const template = await readFile(new URL(`templates/${name}`, root), "utf8");
    assert.doesNotMatch(template, /https?:\/\/|%%[A-Z_]+%%/);
    assert.match(template, /Quizify\.boot/);
    assert.match(template, /_quizify-i18n\.js/);
    assert.match(template, /_quizify\.js/);
  }
});

test("media manifest matches every bundled runtime asset", async () => {
  const manifest = JSON.parse(await readFile(new URL("media-manifest.json", root), "utf8"));
  assert.equal(manifest.schema_version, 1);
  assert(manifest.files["_quizify-i18n.js"]);
  assert(manifest.files["_quizify.js"]);
  assert(manifest.files["_quizify.css"]);
  assert(manifest.files["_persistence.js"]);
  assert(Object.keys(manifest.files).some((name) => /_quizify-katex-.*\.woff2?$/.test(name)));
  const diskMedia = (await readdir(root))
    .filter((name) => /^_quizify.*\.(?:js|css|woff2?|ttf)$/.test(name))
    .concat("_persistence.js")
    .sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), diskMedia);
  for (const [name, expected] of Object.entries(manifest.files)) {
    const data = await readFile(new URL(name, root));
    assert.equal(data.byteLength, expected.bytes, name);
    assert.equal(createHash("sha256").update(data).digest("hex"), expected.sha256, name);
  }
});

test("version and third-party notices are packaged", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  const project = JSON.parse(await readFile(new URL("../package.json", root), "utf8"));
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", root), "utf8"));
  const reviewEntry = await readFile(new URL("../src/review/entry.js", root), "utf8");
  assert.equal(manifest.version, project.version);
  assert.equal(manifest.human_version, project.version);
  assert.equal(manifest.min_point_version, 250900);
  assert.equal(lock.version, project.version);
  assert.equal(lock.packages[""].version, project.version);
  assert.equal(lock.packages[""].engines.node, project.engines.node);
  assert.match(reviewEntry, new RegExp(`version:\\s*["']${project.version.replaceAll(".", "\\.")}["']`));
  const notice = await readFile(new URL("THIRD_PARTY_LICENSES.md", root), "utf8");
  assert.match(notice, /DOMPurify 3\.4\.12/);
  for (const name of [
    "marked-LICENSE.txt",
    "katex-LICENSE.txt",
    "highlight.js-LICENSE.txt",
    "DOMPurify-Apache-LICENSE.txt",
    "DOMPurify-MPL-LICENSE.txt",
    "lucide-ISC-LICENSE.txt",
    "anki-persistence-LICENSE.txt"
  ]) {
    const license = await readFile(new URL(`licenses/${name}`, root), "utf8");
    assert(license.length > 200, name);
  }
});

test("release scripts use stable build roots and verify minified artifacts", async () => {
  const project = JSON.parse(await readFile(new URL("../package.json", root), "utf8"));
  const buildTool = await readFile(new URL("../tools/build.mjs", root), "utf8");
  assert.equal(project.scripts["build:release"], "node tools/build.mjs --release");
  assert.match(project.scripts.package, /build:release.*test:release/);
  assert.match(buildTool, /absWorkingDir:\s*root/);
  assert.match(buildTool, /minify:\s*release/);
});

test("editor bundle contains the isolated debounced live preview", async () => {
  const editor = await readFile(new URL("web/editor.js", root), "utf8");
  const preview = await readFile(new URL("web/editor-preview.js", root), "utf8");
  // The startup bundle includes the three complete UI catalogs so it can
  // switch synchronously without a network or file-system round trip.
  assert(editor.length < 230_000, `startup editor bundle is too large: ${editor.length}`);
  assert.match(editor, /editor-preview\.js/);
  assert.match(preview, /quizify-rendered-preview/);
  assert.match(preview, /attachShadow/);
  assert.match(editor, /quizifyEditorCurrentField/);
  assert.match(editor, /quizify-live-preview-panel/);
  assert.match(preview, /quizify-rendered-preview-field/);
  assert.match(preview, /_quizify-katex-KaTeX_AMS/);
  assert.doesNotMatch(preview, /预览样式未能加载/);
  assert.match(editor, /quizify-panel-portal/);
});

test("review stylesheet exposes its design tokens inside editor shadow roots", async () => {
  const css = await readFile(new URL("_quizify.css", root), "utf8");
  assert.match(css, /:root,\s*:host\s*\{/);
  assert.match(css, /:host\(\.nightMode\)/);
});
