#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { deriveBrowserCapabilities } from "./dependency-risk.mjs";
import { buildPromotionPolicy } from "./promotion-policy.mjs";
import { computeReportLatencySeconds, deriveRuntimeClaimStatuses, evidenceDigest } from "./report.mjs";
import { compareDirectDependencies, compareGatewayContracts } from "./release-tracking.mjs";

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
const browserPodEvidenceSchema = readJson(resolve(root, "packages/compatibility/browserpod-evidence.schema.json"));
const promotionPolicySchema = readJson(resolve(root, "packages/compatibility/promotion-policy.schema.json"));
const historyPath = resolve(dataDirectory, "release-history.json");
const latestPath = resolve(dataDirectory, "compatibility.json");
const history = readJson(historyPath);
const promotionPolicyPath = resolve(dataDirectory, "promotion-policy.json");
const promotionPolicy = readJson(promotionPolicyPath);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateReport = ajv.compile(reportSchema);
const validateHistory = ajv.compile(historySchema);
const validateBrowserPodEvidence = ajv.compile(browserPodEvidenceSchema);
const validatePromotionPolicy = ajv.compile(promotionPolicySchema);

function assertEvidenceClaims(report, label) {
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
    if (entry.id === "browserpod-runtime") {
      assertValid(validateBrowserPodEvidence, evidence, entry.path);
      assert.equal(evidence.target.runtimeVersion, report.target.runtimeVersion, `${label} BrowserPod version drift`);
      assert.equal(evidence.target.browser, report.target.browserBaseline, `${label} BrowserPod browser drift`);
      assert.equal(evidence.artifact.package, report.artifact.package, `${label} BrowserPod package drift`);
      assert.equal(evidence.artifact.version, report.artifact.version, `${label} BrowserPod OpenClaw version drift`);
      assert.equal(evidence.artifact.integrity, report.artifact.integrity, `${label} BrowserPod integrity drift`);
      browserRuntimeEvidence = evidence;
    } else throw new Error(`${label} contains unsupported evidence ${entry.id}`);
  }

  const expectedStatuses = deriveRuntimeClaimStatuses({
    browserRuntimeEvidence
  });
  const checks = new Map(report.checks.map((check) => [check.id, check.status]));
  for (const [id, expected] of Object.entries(expectedStatuses)) {
    assert.equal(checks.get(id), expected, `${label} ${id} status does not match its evidence`);
  }
  const bootCheckId = "openclaw-browserpod-boot";
  assert.equal(report.status, expectedStatuses[bootCheckId] === "pass" ? "partial" : "probing", `${label} overall status drift`);
}

assertValid(validateHistory, history, "release-history.json");
assert.deepEqual(history.releases.map((release) => release.channel), ["stable", "previous", "preview"]);
assert.equal(new Set(history.releases.map((release) => release.version)).size, 3, "tracked release versions must be unique");
assertValid(validatePromotionPolicy, promotionPolicy, "promotion-policy.json");
assert.deepEqual(promotionPolicy, buildPromotionPolicy(history), "promotion-policy.json must be derived from release-history.json");

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
  assert.equal(
    report.artifact.upstreamPublishedAt === undefined,
    report.reportLatencySeconds === undefined,
    `${release.reportPath} must pair artifact.upstreamPublishedAt with reportLatencySeconds`
  );
  if (report.artifact.upstreamPublishedAt !== undefined) {
    assert.equal(
      report.reportLatencySeconds,
      computeReportLatencySeconds(report.artifact.upstreamPublishedAt, report.generatedAt),
      `${release.reportPath} reportLatencySeconds drift`
    );
  }
  assert.equal(release.upstreamPublishedAt, report.artifact.upstreamPublishedAt, `${release.channel} summary upstreamPublishedAt drift`);
  assert.equal(release.reportLatencySeconds, report.reportLatencySeconds, `${release.channel} summary reportLatencySeconds drift`);
  assert.equal(report.artifact.directDependencies.length, report.artifact.directDependencyCount, `${release.channel} direct dependency count drift`);
  assert.deepEqual(
    report.artifact.directDependencies.map(({ name }) => name),
    report.artifact.directDependencies.map(({ name }) => name).toSorted(),
    `${release.channel} direct dependency inventory must be sorted`
  );
  reports.push(report);
}

for (let index = 0; index < history.releases.length; index += 1) {
  const release = history.releases[index];
  const changes = compareDirectDependencies(reports[0].artifact.directDependencies, reports[index].artifact.directDependencies);
  assert.deepEqual(
    release.dependencyChangesFromStable,
    changes,
    `${release.channel} direct dependency changes drift`
  );
  assert.deepEqual(
    release.gatewayContractFromStable,
    compareGatewayContracts(
      reports[0].artifact.gatewayContract,
      reports[index].artifact.gatewayContract
    ),
    `${release.channel} Gateway contract changes drift`
  );
  const expectedRiskChanges = new Map([
    ...changes.added.map(({ name }) => [name, "added"]),
    ...changes.changed.map(({ name }) => [name, "changed"])
  ]);
  assert.equal(release.dependencyRiskFromStable.length, expectedRiskChanges.size, `${release.channel} dependency risk coverage drift`);
  const dependencies = new Map(reports[index].artifact.directDependencies.map((dependency) => [dependency.name, dependency]));
  const riskNames = new Set();
  for (const risk of release.dependencyRiskFromStable) {
    const dependency = dependencies.get(risk.name);
    assert.ok(dependency && !riskNames.has(risk.name), `${release.channel} dependency risk identity drift`);
    riskNames.add(risk.name);
    assert.equal(risk.change, expectedRiskChanges.get(risk.name), `${release.channel} dependency risk change drift`);
    assert.equal(risk.declaredSpec, dependency.spec, `${release.channel} dependency risk spec drift`);
    assert.equal(risk.resolvedVersion, dependency.resolvedVersion, `${release.channel} dependency risk version drift`);
    assert.equal(risk.integrity, dependency.integrity, `${release.channel} dependency risk integrity drift`);
    assert.deepEqual(
      risk.signals.browserCapabilities,
      deriveBrowserCapabilities(risk.signals),
      `${release.channel} dependency capability derivation drift: ${risk.name}`
    );
  }
}

const latest = readJson(latestPath);
assertValid(validateReport, latest, "compatibility.json");
assertEvidenceClaims(latest, "compatibility.json");
assert.deepEqual(latest, reports[0], "compatibility.json must be an exact copy of the stable channel report");
process.stdout.write(`Validated ${reports.length + 1} compatibility reports, release-history.json, and promotion-policy.json.\n`);
