#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertValid(validate, value, label) {
  if (validate(value)) return;
  const detail = validate.errors
    ?.map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ") ?? "unknown schema error";
  throw new Error(`${label} failed schema validation: ${detail}`);
}

const root = process.cwd();
const dataDirectory = resolve(root, "apps/web/public/data");
const reportSchema = readJson(resolve(root, "packages/compatibility/report.schema.json"));
const historySchema = readJson(resolve(root, "packages/compatibility/release-history.schema.json"));
const historyPath = resolve(dataDirectory, "release-history.json");
const latestPath = resolve(dataDirectory, "compatibility.json");
const history = readJson(historyPath);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReport = ajv.compile(reportSchema);
const validateHistory = ajv.compile(historySchema);

assertValid(validateHistory, history, "release-history.json");
assert.deepEqual(history.releases.map((release) => release.channel), ["stable", "previous", "preview"]);
assert.equal(new Set(history.releases.map((release) => release.version)).size, 3, "tracked release versions must be unique");

const reports = [];
for (const release of history.releases) {
  const reportPath = resolve(dirname(historyPath), release.reportPath);
  if (!reportPath.startsWith(`${dataDirectory}${sep}`)) {
    throw new Error(`${release.channel} report path escapes the public data directory.`);
  }
  const report = readJson(reportPath);
  assertValid(validateReport, report, release.reportPath);
  assert.equal(report.artifact.version, release.version, `${release.channel} summary version drift`);
  assert.equal(report.artifact.integrity, release.artifact.integrity, `${release.channel} summary integrity drift`);
  reports.push(report);
}

const latest = readJson(latestPath);
assertValid(validateReport, latest, "compatibility.json");
assert.deepEqual(latest, reports[0], "compatibility.json must be an exact copy of the stable channel report");
process.stdout.write(`Validated ${reports.length + 1} compatibility reports and release-history.json.\n`);
