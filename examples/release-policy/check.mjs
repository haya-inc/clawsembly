#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_POLICY_URL = "https://haya-inc.github.io/clawsembly/data/promotion-policy.json";
const MAX_POLICY_BYTES = 1024 * 1024;
const REASON_IDS = new Set([
  "status-not-supported",
  "runtime-evidence-missing",
  "checks-failed",
  "checks-pending",
  "shrinkwrap-inconsistent",
  "gateway-contract-breaking",
  "gateway-contract-incomplete",
  "dependency-risk-scan-truncated"
]);

function policyUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Promotion policy URL must be credential-free HTTPS without query or fragment aliases.");
  }
  return url;
}

async function readBoundedBody(response) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_POLICY_BYTES)) {
    throw new Error("Promotion policy response exceeds 1 MiB.");
  }
  if (!response.body) throw new Error("Promotion policy response body is missing.");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_POLICY_BYTES) {
      await reader.cancel();
      throw new Error("Promotion policy response exceeds 1 MiB.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function assertGate(gate, channel) {
  const observations = gate?.observations;
  const checks = observations?.checks;
  const countsValid = checks && ["pass", "warn", "fail", "pending"]
    .every((key) => Number.isSafeInteger(checks[key]) && checks[key] >= 0);
  if (gate?.channel !== channel || typeof gate?.version !== "string" || !gate.version
    || typeof gate?.eligible !== "boolean" || !Array.isArray(gate?.reasons)
    || gate.reasons.some((reason) => !REASON_IDS.has(reason))
    || new Set(gate.reasons).size !== gate.reasons.length
    || !["probing", "supported", "partial", "unsupported"].includes(observations?.status)
    || typeof observations?.runtimeEvidence !== "boolean" || !countsValid
    || typeof observations?.shrinkwrapConsistent !== "boolean"
    || !["unchanged", "changed", "additive", "breaking", "incomplete"]
      .includes(observations?.gatewayClassification)
    || !Number.isSafeInteger(observations?.dependencyRiskCount) || observations.dependencyRiskCount < 0
    || !Number.isSafeInteger(observations?.truncatedDependencyRiskCount)
    || observations.truncatedDependencyRiskCount < 0
    || observations.truncatedDependencyRiskCount > observations.dependencyRiskCount) {
    throw new Error(`Promotion policy ${channel} gate is invalid.`);
  }
  const expectedReasons = [];
  if (observations.status !== "supported") expectedReasons.push("status-not-supported");
  if (!observations.runtimeEvidence) expectedReasons.push("runtime-evidence-missing");
  if (checks.fail > 0) expectedReasons.push("checks-failed");
  if (checks.pending > 0) expectedReasons.push("checks-pending");
  if (!observations.shrinkwrapConsistent) expectedReasons.push("shrinkwrap-inconsistent");
  if (observations.gatewayClassification === "breaking") expectedReasons.push("gateway-contract-breaking");
  if (observations.gatewayClassification === "incomplete") expectedReasons.push("gateway-contract-incomplete");
  if (observations.truncatedDependencyRiskCount > 0) expectedReasons.push("dependency-risk-scan-truncated");
  if (gate.reasons.length !== expectedReasons.length
    || gate.reasons.some((reason, index) => reason !== expectedReasons[index])
    || gate.eligible !== (expectedReasons.length === 0)) {
    throw new Error(`Promotion policy ${channel} gate contradicts its observations.`);
  }
}

export function assertPromotionPolicy(policy) {
  if (policy?.schemaVersion !== 1 || !Number.isFinite(Date.parse(policy?.generatedAt))
    || policy?.package !== "openclaw" || !["promote", "hold"].includes(policy?.decision)) {
    throw new Error("Promotion policy identity is invalid.");
  }
  assertGate(policy.baseline, "stable");
  assertGate(policy.candidate, "preview");
  assertGate(policy.rollback, "previous");
  if ((policy.decision === "promote") !== policy.candidate.eligible) {
    throw new Error("Promotion policy decision contradicts its candidate gate.");
  }
  return policy;
}

export async function loadPromotionPolicy({ url = DEFAULT_POLICY_URL, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A Fetch-compatible implementation is required.");
  const target = policyUrl(url);
  const response = await fetchImpl(target, {
    headers: { Accept: "application/json" },
    redirect: "error"
  });
  if (!response.ok) throw new Error(`Promotion policy request failed: ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error("Promotion policy response is not JSON.");
  const source = await readBoundedBody(response);
  let policy;
  try { policy = JSON.parse(source); }
  catch { throw new Error("Promotion policy response contains invalid JSON."); }
  return assertPromotionPolicy(policy);
}

export function formatPromotionPolicy(policy) {
  const reasons = policy.candidate.reasons.length ? policy.candidate.reasons.join(", ") : "none";
  return `OpenClaw ${policy.candidate.version}: ${policy.decision.toUpperCase()} (${reasons})`;
}

export async function runPromotionCheck({ observe = false, ...options } = {}) {
  const policy = await loadPromotionPolicy(options);
  process.stdout.write(`${formatPromotionPolicy(policy)}\n`);
  if (!observe && policy.decision !== "promote") process.exitCode = 1;
  return policy;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  runPromotionCheck({
    observe: process.argv.includes("--observe"),
    url: process.env.CLAWSEMBLY_POLICY_URL ?? DEFAULT_POLICY_URL
  }).catch((error) => {
    process.stderr.write(`Clawsembly policy check failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
