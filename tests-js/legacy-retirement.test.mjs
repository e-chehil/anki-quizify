import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const name of ["front.html", "back.html"]) {
  test(`${name} fails closed instead of running the retired network template`, async () => {
    const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
    assert.match(source, /RETIRED LEGACY TEMPLATE/);
    assert.doesNotMatch(source, /{{(?:Front|Back)}}|<script|https?:\/\//i);
  });
}
