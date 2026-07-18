import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const files = readdirSync("tests")
  .filter((name) => name.endsWith(".test.js"))
  .sort();

for (const name of files) {
  const result = spawnSync(process.execPath, [path.join("tests", name)], {
    stdio: "inherit"
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
