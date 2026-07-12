const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;

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
    || typeof report.artifact.integrity !== "string" || !report.artifact.integrity.startsWith("sha512-")
    || typeof report.generatedAt !== "string" || !Number.isFinite(Date.parse(report.generatedAt))
    || !["probing", "partial", "supported", "unsupported"].includes(report.status)
    || typeof report.target.runtime !== "string") {
    throw new TypeError("compatibility report cannot identify an exact OpenClaw artifact");
  }
}

/**
 * Creates a deterministic host launch manifest. A selected runtime is not
 * launchable in verified mode until the supplied report is both supported and
 * captured against that exact runtime.
 */
export function createEmbedManifest({ report, runtime = "browserpod", capabilities = [] }) {
  assertReport(report);
  if (runtime !== "browserpod") throw new TypeError("BrowserPod is the adopted embedded runtime");
  const grants = normalizeCapabilities(capabilities);
  const runtimeMatched = report.target.runtime === runtime;
  const supported = report.status === "supported";
  const blockers = Object.freeze([
    ...(!runtimeMatched ? [`report targets ${report.target.runtime}, not ${runtime}`] : []),
    ...(!supported ? [`report status is ${report.status}, not supported`] : [])
  ]);
  return Object.freeze({
    schemaVersion: 1,
    artifact: Object.freeze({
      package: "openclaw",
      version: report.artifact.version,
      integrity: report.artifact.integrity
    }),
    runtime,
    evidence: Object.freeze({
      generatedAt: report.generatedAt,
      reportStatus: report.status,
      reportRuntime: report.target.runtime,
      verifiedForRuntime: runtimeMatched && supported
    }),
    capabilities: grants,
    launchable: blockers.length === 0,
    blockers
  });
}

export function assertVerifiedLaunch(manifest) {
  if (!plainObject(manifest) || manifest.schemaVersion !== 1 || manifest.runtime !== "browserpod") {
    throw new TypeError("embed manifest is invalid");
  }
  if (manifest.launchable !== true || manifest.evidence?.verifiedForRuntime !== true) {
    const detail = Array.isArray(manifest.blockers) ? manifest.blockers.join("; ") : "runtime evidence is missing";
    throw new Error(`verified BrowserPod launch blocked: ${detail}`);
  }
  return manifest;
}
