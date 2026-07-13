const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_REPORT_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const verifiedReports = new WeakSet();

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("verified report exceeds the byte limit");
    return bytes;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) throw new Error("verified report body is invalid");
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("verified report exceeds the byte limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function assertExpectation(expectation) {
  let url;
  try { url = new URL(expectation?.url); }
  catch { throw new TypeError("verified report URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("verified report URL must be credential-free HTTPS without query or fragment");
  }
  if (!SHA256_PATTERN.test(expectation?.sha256)
    || typeof expectation?.artifact?.package !== "string"
    || expectation.artifact.package.length > PACKAGE_NAME_MAX_LENGTH
    || !PACKAGE_NAME_PATTERN.test(expectation.artifact.package)
    || !VERSION_PATTERN.test(expectation?.artifact?.version)
    || !INTEGRITY_PATTERN.test(expectation?.artifact?.integrity)
    || expectation?.target?.runtime !== "browserpod"
    || typeof expectation?.target?.runtimeVersion !== "string"
    || expectation.target.runtimeVersion.length === 0
    || !Number.isSafeInteger(expectation?.maxAgeMs)
    || expectation.maxAgeMs < 60_000 || expectation.maxAgeMs > MAX_REPORT_AGE_MS) {
    throw new TypeError("verified report expectation is incomplete");
  }
  return url.href;
}

function assertReportShape(report, expectation) {
  const failures = [];
  if (!plainObject(report) || report.schemaVersion !== 1) failures.push("schema");
  if (!Number.isFinite(Date.parse(report?.generatedAt))) failures.push("timestamp");
  if (!["probing", "partial", "supported", "unsupported"].includes(report?.status)) failures.push("status");
  if (report?.artifact?.package !== expectation.artifact.package
    || report?.artifact?.version !== expectation.artifact.version
    || report?.artifact?.integrity !== expectation.artifact.integrity) failures.push("artifact identity");
  if (report?.target?.runtime !== expectation.target.runtime
    || report?.target?.runtimeVersion !== expectation.target.runtimeVersion
    || typeof report?.target?.browserBaseline !== "string") failures.push("runtime target");
  if (!Array.isArray(report?.evidence) || !Array.isArray(report?.checks) || report.checks.length === 0) {
    failures.push("evidence/checks");
  }
  const checkIds = new Set();
  for (const check of report?.checks ?? []) {
    if (!plainObject(check) || typeof check.id !== "string" || checkIds.has(check.id)
      || !["pass", "warn", "fail", "pending"].includes(check.status)) failures.push("check integrity");
    checkIds.add(check?.id);
  }
  for (const evidence of report?.evidence ?? []) {
    if (!plainObject(evidence) || typeof evidence.id !== "string"
      || typeof evidence.path !== "string" || evidence.path.startsWith("/") || evidence.path.includes("..")
      || !SHA256_PATTERN.test(evidence.sha256)) failures.push("evidence reference");
  }
  if (report?.status === "supported") {
    if (!(report.evidence ?? []).some((entry) => entry.kind === "browser-runtime")) failures.push("supported runtime evidence");
    if ((report.checks ?? []).some((check) => check.status === "fail" || check.status === "pending")) {
      failures.push("supported check status");
    }
  }
  if (report?.status === "partial" && (report.evidence ?? []).length === 0) failures.push("partial evidence");
  if (report?.status === "unsupported" && !(report.checks ?? []).some((check) => check.status === "fail")) {
    failures.push("unsupported failure");
  }
  if (failures.length) throw new TypeError(`verified compatibility report is invalid: ${[...new Set(failures)].join(", ")}`);
  return report;
}

/**
 * Fetches one exact compatibility report and binds its raw bytes, source URL,
 * upstream artifact, and BrowserPod target before it can authorize launch.
 */
export async function loadVerifiedCompatibilityReport(expectation, {
  fetchImpl = globalThis.fetch,
  cryptoApi = globalThis.crypto,
  maxBytes = DEFAULT_MAX_BYTES,
  now = Date.now
} = {}) {
  const url = assertExpectation(expectation);
  if (typeof fetchImpl !== "function" || !cryptoApi?.subtle?.digest || typeof now !== "function") {
    throw new TypeError("fetch and Web Crypto are required for report verification");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) {
    throw new TypeError(`verified report maxBytes must be between 1 and ${DEFAULT_MAX_BYTES}`);
  }

  const response = await fetchImpl(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!response?.ok || response.redirected === true) throw new Error("verified report request failed");
  const contentType = response.headers?.get?.("content-type") ?? "";
  if (!/^application\/json(?:;|$)/iu.test(contentType)) throw new Error("verified report content type is invalid");
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("verified report exceeds the byte limit");

  const bytes = await readBoundedBody(response, maxBytes);
  if (bytes.byteLength < 2) throw new Error("verified report is smaller than the minimum plausible document");
  const sha256 = bytesToHex(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes)));
  if (sha256 !== expectation.sha256) throw new Error("verified report SHA-256 does not match the pinned bytes");

  let report;
  try { report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("verified report JSON is invalid"); }
  assertReportShape(report, expectation);
  const generatedAtMs = Date.parse(report.generatedAt);
  const verifiedAtMs = now();
  if (!Number.isFinite(verifiedAtMs)) throw new TypeError("verified report clock is invalid");
  const ageMs = verifiedAtMs - generatedAtMs;
  if (ageMs < -5 * 60_000 || ageMs > expectation.maxAgeMs) {
    throw new Error("verified report is outside the accepted freshness window");
  }
  const expiresAt = new Date(generatedAtMs + expectation.maxAgeMs).toISOString();

  const result = deepFreeze({
    report,
    verification: {
      url,
      sha256,
      bytes: bytes.byteLength,
      verifiedAt: new Date(verifiedAtMs).toISOString(),
      expiresAt
    }
  });
  verifiedReports.add(result);
  return result;
}

// Runtime-only bridge used by embed-manifest.mjs. It can inspect a branded
// result but cannot brand caller-created objects.
export function unwrapVerifiedCompatibilityReport(value) {
  return verifiedReports.has(value) ? value : undefined;
}
