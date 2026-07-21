// Performance-baseline schema and aggregation for the hello-agent reference
// binding chain (issue #8). The baseline binds every number to the exact
// artifact identity, provider version, browser, and host OS, and it is
// deliberately payload-free: the schema has no field that could carry
// credentials, prompts, or user content. These are boundary-chain numbers on
// the reference binding; they claim nothing about any real upstream agent —
// OpenClaw install and Gateway timings stay open until the vendor gaps in
// issues #6/#47 close.
import { HELLO_AGENT_ARTIFACT } from "./hello-agent-artifact.generated.mjs";

export const HELLO_AGENT_PERF_PASS_KINDS = Object.freeze([
  // Fresh browser context (empty HTTP/wasm caches) and a fresh workspace.
  "cold",
  // Same browser context after a reload (caches populated), fresh workspace.
  "warm",
  // Same browser context and the same workspace storage key as a previous
  // boot: measures the provider's persistent-filesystem reuse path.
  "persistentReuse"
]);

const PASS_KIND_SET = new Set(HELLO_AGENT_PERF_PASS_KINDS);
const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const PHASE_FIELDS = Object.freeze([
  // bootHelloAgentEmbed total: provider boot + mailbox init + guest staging.
  "bootMs",
  // The provider's own boot duration as reported by the runtime boot audit.
  "providerBootMs",
  // Digest-verified staging of the exact artifact files.
  "installMs",
  // process.start(): supervisor spawn until both readiness signals.
  "readyMs",
  // First hello.say protocol round trip (health/handshake equivalent).
  "helloRoundTripMs",
  // Cooperative close: nonce-bound guest-supervisor shutdown.
  "closeMs"
]);

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isDurationMs(value) {
  return Number.isFinite(value) && value >= 0;
}

function isStorageBytes(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

/**
 * Validates one measured boot. Fails closed on any unknown pass kind,
 * non-finite duration, or artifact/staging mismatch, so a broken capture can
 * never aggregate into a publishable baseline.
 */
export function assertHelloAgentPerfSample(sample) {
  const failures = [];
  if (sample?.schemaVersion !== 1) failures.push("identity");
  if (!PASS_KIND_SET.has(sample?.passKind)) failures.push("pass kind");
  if (typeof sample?.workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(sample.workspaceId)) {
    failures.push("workspace id");
  }
  for (const field of PHASE_FIELDS) {
    if (!isDurationMs(sample?.phases?.[field])) failures.push(`phase ${field}`);
  }
  if (isDurationMs(sample?.phases?.bootMs) && isDurationMs(sample?.phases?.providerBootMs)
    && sample.phases.providerBootMs > sample.phases.bootMs) {
    failures.push("provider boot exceeds total boot");
  }
  if (sample?.install?.integrityMatched !== true
    || sample?.install?.fileCount !== HELLO_AGENT_ARTIFACT.files.length
    || !isCount(sample?.install?.stagedBytes)) failures.push("install integrity");
  if (!isStorageBytes(sample?.storage?.beforeUsageBytes)
    || !isStorageBytes(sample?.storage?.afterUsageBytes)) failures.push("storage estimate");
  if (failures.length) throw new Error(`Invalid hello-agent perf sample: ${failures.join(", ")}`);
  return sample;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Aggregates validated samples of one pass kind into medians plus the raw
 * samples, per the issue #8 requirement that individual samples stay
 * reportable next to the median.
 */
export function summarizeHelloAgentPerfSamples(passKind, samples) {
  if (!PASS_KIND_SET.has(passKind)) {
    throw new Error(`Unknown hello-agent perf pass kind: ${String(passKind)}`);
  }
  if (!Array.isArray(samples) || samples.length < 1) {
    throw new Error("hello-agent perf summary needs at least one sample");
  }
  for (const sample of samples) {
    assertHelloAgentPerfSample(sample);
    if (sample.passKind !== passKind) {
      throw new Error(`hello-agent perf sample pass kind ${sample.passKind} does not belong to ${passKind}`);
    }
  }
  const medianMs = {};
  for (const field of PHASE_FIELDS) {
    medianMs[field] = median(samples.map((sample) => sample.phases[field]));
  }
  return Object.freeze({
    passKind,
    sampleCount: samples.length,
    // Issue #8 requires at least three samples per path for a publishable
    // baseline; smaller runs stay valid as exploratory captures.
    meetsSampleFloor: samples.length >= 3,
    medianMs: Object.freeze(medianMs),
    samples: Object.freeze([...samples])
  });
}

/**
 * Validates a complete baseline document: exact identity binding, at least
 * one summarized pass, and every sample recursively valid. Returns the
 * baseline for chaining.
 */
export function assertHelloAgentPerfBaseline(baseline) {
  const failures = [];
  if (baseline?.schemaVersion !== 1 || !Number.isFinite(Date.parse(baseline?.capturedAt))) {
    failures.push("identity");
  }
  if (baseline?.target?.runtime !== "browserpod" || baseline?.target?.browserLocal !== true
    || typeof baseline?.target?.runtimeVersion !== "string"
    || typeof baseline?.target?.browser !== "string"
    || typeof baseline?.target?.os !== "string") failures.push("target");
  if (baseline?.artifact?.package !== HELLO_AGENT_ARTIFACT.name
    || baseline?.artifact?.version !== HELLO_AGENT_ARTIFACT.version
    || baseline?.artifact?.integrity !== HELLO_AGENT_ARTIFACT.integrity) failures.push("artifact identity");
  if (baseline?.scope?.chain !== "hello-agent-reference-binding"
    || baseline?.scope?.upstreamApplicability !== "none") failures.push("scope honesty");
  const passes = baseline?.passes;
  if (!passes || typeof passes !== "object" || Array.isArray(passes)) {
    failures.push("passes");
  } else {
    const keys = Object.keys(passes);
    if (keys.length < 1 || keys.some((key) => !PASS_KIND_SET.has(key))) failures.push("pass kinds");
    for (const key of keys) {
      const summary = passes[key];
      if (summary?.passKind !== key || !isCount(summary?.sampleCount)
        || summary.sampleCount < 1 || typeof summary?.meetsSampleFloor !== "boolean"
        || !Array.isArray(summary?.samples)
        || summary.samples.length !== summary.sampleCount) {
        failures.push(`pass ${key}`);
        continue;
      }
      for (const field of PHASE_FIELDS) {
        if (!isDurationMs(summary?.medianMs?.[field])) failures.push(`pass ${key} median ${field}`);
      }
      try {
        for (const sample of summary.samples) assertHelloAgentPerfSample(sample);
      } catch {
        failures.push(`pass ${key} samples`);
      }
    }
  }
  if (failures.length) throw new Error(`Invalid hello-agent perf baseline: ${failures.join(", ")}`);
  return baseline;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text)
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Digest-bound baseline reference, mirroring helloAgentEvidenceRecord: the
 * SHA-256 covers the canonicalized baseline so a stored document cannot be
 * tampered with undetectably.
 */
export async function helloAgentPerfRecord(baseline) {
  assertHelloAgentPerfBaseline(baseline);
  const passNames = Object.keys(baseline.passes).sort();
  const counts = passNames
    .map((name) => `${name}×${baseline.passes[name].sampleCount}`)
    .join(", ");
  return Object.freeze({
    id: "hello-agent-perf-baseline",
    kind: "browser-runtime-performance",
    capturedAt: baseline.capturedAt,
    path: `evidence/hello-agent-perf-${baseline.artifact.version}.json`,
    sha256: await sha256Hex(JSON.stringify(canonicalize(baseline))),
    summary: `Boundary-chain performance baseline for the exact ${baseline.artifact.package} ${baseline.artifact.version} artifact on ${baseline.target.runtimeVersion} (${counts} sampled boots; medians over provider boot, staging, readiness, first round trip, and cooperative close) in ${baseline.target.browser} on ${baseline.target.os}. Reference-binding numbers only; no upstream agent performance is claimed.`
  });
}
