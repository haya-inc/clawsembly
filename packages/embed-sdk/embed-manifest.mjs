import { BROWSERPOD_ADAPTER_VERSION } from "../browser-runtime/browserpod-runtime.mjs";
import { unwrapVerifiedCompatibilityReport } from "./report-loader.mjs";

export { bootVerifiedEmbed, createArtifactStorageKey } from "./boot.mjs";

const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) throw new TypeError("embed capabilities must be an array");
  const seen = new Set();
  return Object.freeze(capabilities.map((grant) => {
    if (!plainObject(grant) || typeof grant.capability !== "string" || !CAPABILITY_PATTERN.test(grant.capability)
      || typeof grant.scope !== "string" || grant.scope.length === 0 || grant.scope.length > 256) {
      throw new TypeError("embed capability grant is invalid");
    }
    const key = `${grant.capability}\u0000${grant.scope}`;
    if (seen.has(key)) throw new TypeError("embed capability grants must be unique");
    seen.add(key);
    const maxCalls = grant.maxCalls ?? 1;
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10_000) {
      throw new TypeError("embed capability call limit is invalid");
    }
    return Object.freeze({ capability: grant.capability, scope: grant.scope, maxCalls });
  }));
}

function assertReport(report) {
  if (!plainObject(report) || !plainObject(report.artifact) || !plainObject(report.target)
    || report.artifact.package !== "openclaw" || typeof report.artifact.version !== "string"
    || !VERSION_PATTERN.test(report.artifact.version)
    || typeof report.artifact.integrity !== "string" || !INTEGRITY_PATTERN.test(report.artifact.integrity)
    || typeof report.generatedAt !== "string" || !Number.isFinite(Date.parse(report.generatedAt))
    || !["probing", "partial", "supported", "unsupported"].includes(report.status)
    || typeof report.target.runtime !== "string"
    || (report.target.runtimeVersion !== undefined && typeof report.target.runtimeVersion !== "string")) {
    throw new TypeError("compatibility report cannot identify an exact OpenClaw artifact");
  }
}

/**
 * Creates a deterministic host launch manifest. A selected runtime is not
 * launchable in verified mode until the supplied report is both supported and
 * captured against that exact runtime.
 */
export function createEmbedManifest({ report, runtime = "browserpod", capabilities = [] }) {
  const verifiedReport = unwrapVerifiedCompatibilityReport(report);
  const reportValue = verifiedReport?.report ?? report;
  assertReport(reportValue);
  if (runtime !== "browserpod") throw new TypeError("BrowserPod is the adopted embedded runtime");
  const grants = normalizeCapabilities(capabilities);
  const providerMatched = reportValue.target.runtime === runtime;
  const versionMatched = reportValue.target.runtimeVersion === BROWSERPOD_ADAPTER_VERSION;
  const supported = reportValue.status === "supported";
  const sourceVerified = Boolean(verifiedReport);
  const blockers = Object.freeze([
    ...(!sourceVerified ? ["report source and SHA-256 are unverified"] : []),
    ...(!providerMatched ? [`report targets ${reportValue.target.runtime}, not ${runtime}`] : []),
    ...(!versionMatched ? [`report runtime version is ${reportValue.target.runtimeVersion ?? "unreported"}, not ${BROWSERPOD_ADAPTER_VERSION}`] : []),
    ...(!supported ? [`report status is ${reportValue.status}, not supported`] : [])
  ]);
  return Object.freeze({
    schemaVersion: 1,
    artifact: Object.freeze({
      package: "openclaw",
      version: reportValue.artifact.version,
      integrity: reportValue.artifact.integrity
    }),
    runtime,
    runtimeVersion: BROWSERPOD_ADAPTER_VERSION,
    evidence: Object.freeze({
      generatedAt: reportValue.generatedAt,
      reportStatus: reportValue.status,
      reportRuntime: reportValue.target.runtime,
      reportRuntimeVersion: reportValue.target.runtimeVersion ?? null,
      reportUrl: verifiedReport?.verification.url ?? null,
      reportSha256: verifiedReport?.verification.sha256 ?? null,
      reportBytes: verifiedReport?.verification.bytes ?? null,
      reportExpiresAt: verifiedReport?.verification.expiresAt ?? null,
      reportVerified: sourceVerified,
      verifiedForRuntime: sourceVerified && providerMatched && versionMatched && supported
    }),
    capabilities: grants,
    launchable: blockers.length === 0,
    blockers
  });
}

export function assertVerifiedLaunch(manifest) {
  if (!plainObject(manifest) || manifest.schemaVersion !== 1 || manifest.runtime !== "browserpod"
    || manifest.runtimeVersion !== BROWSERPOD_ADAPTER_VERSION || !plainObject(manifest.artifact)
    || manifest.artifact.package !== "openclaw" || typeof manifest.artifact.version !== "string"
    || !VERSION_PATTERN.test(manifest.artifact.version) || typeof manifest.artifact.integrity !== "string"
    || !INTEGRITY_PATTERN.test(manifest.artifact.integrity) || !Array.isArray(manifest.capabilities)) {
    throw new TypeError("embed manifest is invalid");
  }
  normalizeCapabilities(manifest.capabilities);
  if (manifest.launchable !== true || manifest.evidence?.verifiedForRuntime !== true) {
    const detail = Array.isArray(manifest.blockers) ? manifest.blockers.join("; ") : "runtime evidence is missing";
    throw new Error(`verified BrowserPod launch blocked: ${detail}`);
  }
  if (manifest.evidence?.reportStatus !== "supported"
    || manifest.evidence?.reportRuntime !== "browserpod"
    || manifest.evidence?.reportRuntimeVersion !== BROWSERPOD_ADAPTER_VERSION
    || manifest.evidence?.reportVerified !== true
    || typeof manifest.evidence?.reportUrl !== "string" || !manifest.evidence.reportUrl.startsWith("https://")
    || typeof manifest.evidence?.reportSha256 !== "string" || !SHA256_PATTERN.test(manifest.evidence.reportSha256)
    || !Number.isSafeInteger(manifest.evidence?.reportBytes) || manifest.evidence.reportBytes < 1
    || typeof manifest.evidence?.reportExpiresAt !== "string"
    || Date.parse(manifest.evidence.reportExpiresAt) <= Date.now()
    || !Array.isArray(manifest.blockers) || manifest.blockers.length !== 0) {
    throw new TypeError("embed manifest evidence is inconsistent");
  }
  return manifest;
}
