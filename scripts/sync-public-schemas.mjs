#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = process.cwd();
const schemas = [
  ["packages/capability-broker", "capability-manifest.schema.json"],
  ["packages/capability-broker", "capability-audit.schema.json"],
  ["packages/compatibility", "report.schema.json"],
  ["packages/compatibility", "release-history.schema.json"],
  ["packages/compatibility", "browserpod-evidence.schema.json"],
  ["packages/compatibility", "promotion-policy.schema.json"]
];
let stale = false;

for (const [directory, name] of schemas) {
  const source = resolve(root, directory, name);
  const target = resolve(root, "apps/web/public/schemas", name);
  const expected = await readFile(source, "utf8");
  if (process.argv.includes("--check")) {
    let current;
    try { current = await readFile(target, "utf8"); }
    catch { current = undefined; }
    if (current !== expected) {
      stale = true;
      process.stderr.write(`Public schema is stale: ${name}\n`);
    }
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, expected, "utf8");
    process.stdout.write(`Wrote ${target}\n`);
  }
}

if (stale) {
  process.stderr.write("Run npm run schemas:sync.\n");
  process.exitCode = 1;
} else if (process.argv.includes("--check")) {
  process.stdout.write("Public schemas are current.\n");
}
