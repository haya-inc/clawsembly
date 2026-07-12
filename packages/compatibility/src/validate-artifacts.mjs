#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { deriveRuntimeClaimStatuses, evidenceDigest } from "./report.mjs";

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
const hostEvidenceSchema = readJson(resolve(root, "packages/compatibility/host-evidence.schema.json"));
const gatewayEvidenceSchema = readJson(resolve(root, "packages/compatibility/gateway-evidence.schema.json"));
const browserPodEvidenceSchema = readJson(resolve(root, "packages/compatibility/browserpod-evidence.schema.json"));
const historyPath = resolve(dataDirectory, "release-history.json");
const latestPath = resolve(dataDirectory, "compatibility.json");
const history = readJson(historyPath);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReport = ajv.compile(reportSchema);
const validateHistory = ajv.compile(historySchema);
const validateHostEvidence = ajv.compile(hostEvidenceSchema);
const validateGatewayEvidence = ajv.compile(gatewayEvidenceSchema);
const validateBrowserPodEvidence = ajv.compile(browserPodEvidenceSchema);

function assertEvidenceClaims(report, label) {
  let hostEvidence;
  let gatewayEvidence;
  let browserRuntimeEvidence;
  const evidenceByPath = new Map();
  for (const entry of report.evidence) {
    const evidencePath = resolve(dataDirectory, entry.path);
    if (!evidencePath.startsWith(`${dataDirectory}${sep}`)) {
      throw new Error(`${label} evidence path escapes the public data directory: ${entry.path}`);
    }
    const evidence = evidenceByPath.get(evidencePath) ?? readJson(evidencePath);
    evidenceByPath.set(evidencePath, evidence);
    assert.equal(entry.capturedAt, evidence.capturedAt, `${label} ${entry.id} capturedAt drift`);
    assert.equal(entry.sha256, evidenceDigest(evidence), `${label} ${entry.id} evidence digest drift`);
    if (entry.id === "host-preflight") {
      assertValid(validateHostEvidence, evidence, entry.path);
      hostEvidence = evidence;
    } else if (entry.id === "browserpod-runtime") {
      assertValid(validateBrowserPodEvidence, evidence, entry.path);
      assert.equal(evidence.target.runtimeVersion, report.target.runtimeVersion, `${label} BrowserPod version drift`);
      assert.equal(evidence.target.browser, report.target.browserBaseline, `${label} BrowserPod browser drift`);
      assert.equal(evidence.artifact.package, report.artifact.package, `${label} BrowserPod package drift`);
      assert.equal(evidence.artifact.version, report.artifact.version, `${label} BrowserPod OpenClaw version drift`);
      assert.equal(evidence.artifact.integrity, report.artifact.integrity, `${label} BrowserPod integrity drift`);
      browserRuntimeEvidence = evidence;
    } else {
      assertValid(validateGatewayEvidence, evidence, entry.path);
      assert.equal(evidence.openclaw.version, report.artifact.version, `${label} ${entry.id} OpenClaw version drift`);
      gatewayEvidence = evidence;
    }
  }

  const expectedStatuses = deriveRuntimeClaimStatuses({
    hostEvidence,
    gatewayEvidence,
    browserRuntimeEvidence,
    targetRuntime: report.target.runtime
  });
  const checks = new Map(report.checks.map((check) => [check.id, check.status]));
  for (const [id, expected] of Object.entries(expectedStatuses)) {
    assert.equal(checks.get(id), expected, `${label} ${id} status does not match its evidence`);
  }
  const bootCheckId = `openclaw-${report.target.runtime}-boot`;
  assert.equal(report.status, expectedStatuses[bootCheckId] === "pass" ? "partial" : "probing", `${label} overall status drift`);
}

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
  assertEvidenceClaims(report, release.reportPath);
  assert.equal(report.artifact.version, release.version, `${release.channel} summary version drift`);
  assert.equal(report.artifact.integrity, release.artifact.integrity, `${release.channel} summary integrity drift`);
  reports.push(report);
}

const latest = readJson(latestPath);
assertValid(validateReport, latest, "compatibility.json");
assertEvidenceClaims(latest, "compatibility.json");
assert.deepEqual(latest, reports[0], "compatibility.json must be an exact copy of the stable channel report");
process.stdout.write(`Validated ${reports.length + 1} compatibility reports and release-history.json.\n`);
