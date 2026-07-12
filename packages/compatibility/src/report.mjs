import { createHash } from "node:crypto";

const RISK_RULES = [
  {
    pattern: /(^|\/)@lydell\/node-pty(?:-|$)|(^|\/)node-pty(?:-|$)/,
    reason: "Ships platform-specific PTY binaries that cannot execute in the selected browser Wasm runtime."
  },
  {
    pattern: /(^|\/)sqlite-vec(?:-|$)/,
    reason: "Ships platform-specific SQLite extensions and must remain optional."
  }
];

const PENDING_RUNTIME_CHECKS = Object.freeze({
  "gateway-handshake": "A successful hello-ok frame is required before this release can be supported.",
  "mocked-chat-turn": "A streamed mocked turn through the real agent runner is required.",
  "mocked-tool-call": "A deterministic tool request and result round-trip is required.",
  "history-reconnect": "History must survive a WebSocket disconnect and authenticated reconnect.",
  "chat-cancellation": "An active streamed turn must stop through chat.abort and emit an aborted event.",
  "credential-vault": "Provider credentials must remain encrypted in the browser host and outside BrowserPod.",
  "provider-broker": "Provider traffic must cross a fixed-destination, secret-redacting browser-host broker before live testing.",
  "host-broker-turn": "A real OpenClaw agent turn must cross the browser-host provider broker without mounting or logging credentials in BrowserPod.",
  "provider-budget": "Provider traffic needs user-visible request, input, and streamed-output limits before live opt-in.",
  "live-opt-in-gate": "Live traffic needs a fixed-prompt, cost-bounded, credential-and-consent gate before it can be enabled.",
  "device-identity": "A browser-owned non-extractable device key must complete pairing and token-authenticated reconnect without leaking credentials.",
  "opfs-recovery": "The mock session must survive persisted save, fresh BrowserPod boot, restore, and document reload."
});

const CHECK_LABELS = Object.freeze({
  "gateway-handshake": "Gateway handshake",
  "mocked-chat-turn": "Provider-independent chat turn",
  "mocked-tool-call": "Constrained tool execution",
  "history-reconnect": "History after reconnect",
  "chat-cancellation": "Streaming cancellation",
  "credential-vault": "Encrypted credential boundary",
  "provider-broker": "Provider request policy",
  "host-broker-turn": "OpenClaw host-broker turn",
  "provider-budget": "User-configurable provider budget",
  "live-opt-in-gate": "Protected live opt-in gate",
  "device-identity": "Device pairing and token reconnect",
  "opfs-recovery": "Runtime state recovery"
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

export function normalizeReportTarget(target = {}) {
  const runtime = target.runtime ?? "browserpod";
  if (runtime !== "browserpod") {
    throw new Error(`Unsupported compatibility runtime target: ${runtime}; Clawsembly is BrowserPod-only.`);
  }
  const runtimeVersion = target.runtimeVersion;
  if (typeof runtimeVersion !== "string" || runtimeVersion.length === 0) {
    throw new Error("BrowserPod compatibility targets require an exact runtimeVersion.");
  }
  const browserBaseline = target.browserBaseline
    ?? "Desktop Chromium; Firefox and WebKit pending BrowserPod evidence.";
  if (typeof browserBaseline !== "string" || browserBaseline.length === 0) {
    throw new Error("Compatibility target browserBaseline is required.");
  }
  return Object.freeze({ runtime: "browserpod", runtimeVersion, browserBaseline });
}

export function runtimeBootCheckId() {
  return "openclaw-browserpod-boot";
}

export function evidenceDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

export function assertBrowserRuntimeEvidence(evidence) {
  const failures = [];
  if (evidence?.schemaVersion !== 1 || !Number.isFinite(Date.parse(evidence?.capturedAt))) failures.push("identity");
  if (evidence?.target?.runtime !== "browserpod" || evidence?.target?.browserLocal !== true
    || typeof evidence?.target?.runtimeVersion !== "string" || typeof evidence?.target?.browser !== "string") {
    failures.push("target");
  }
  if (evidence?.preflight?.checks?.nodeBaseline !== true
    || evidence?.preflight?.checks?.cryptoVerify !== true
    || evidence?.preflight?.checks?.sqlite !== true) failures.push("preflight");
  if (evidence?.install?.result !== "pass" || evidence?.install?.integrityMatched !== true
    || evidence?.install?.installedVersion !== evidence?.artifact?.version
    || evidence?.install?.lockIntegrity !== evidence?.artifact?.integrity) failures.push("install integrity");
  const readiness = evidence?.gateway?.readiness;
  let portalProtocol;
  try { portalProtocol = new URL(evidence?.gateway?.portal?.url).protocol; } catch { portalProtocol = undefined; }
  if (evidence?.gateway?.result !== "pass" || readiness?.output !== true
    || readiness?.portal !== true || readiness?.healthz !== true || readiness?.readyz !== true
    || evidence?.gateway?.portal?.visibility !== "public-url" || portalProtocol !== "https:"
    || evidence?.gateway?.healthz?.status !== 200 || evidence?.gateway?.readyz?.status !== 200
    || evidence?.gateway?.termination?.mode !== "guest-supervisor"
    || evidence?.gateway?.termination?.result !== "pass"
    || evidence?.gateway?.termination?.providerProcessTermination !== false
    || evidence?.gateway?.termination?.hardDispose !== false) failures.push("Gateway readiness");
  if (!Array.isArray(evidence?.limitations)
    || !["provider-process-termination-unavailable", "hard-dispose-unavailable", "portal-is-public-url"]
      .every((limitation) => evidence.limitations.includes(limitation))) failures.push("limitations");
  if (failures.length) throw new Error(`Invalid BrowserPod evidence: ${failures.join(", ")}`);
  return evidence;
}

export function deriveRuntimeClaimStatuses({ browserRuntimeEvidence } = {}) {
  const preflightPassed = browserRuntimeEvidence?.preflight?.checks?.nodeBaseline === true
    && browserRuntimeEvidence?.preflight?.checks?.cryptoVerify === true
    && browserRuntimeEvidence?.preflight?.checks?.sqlite === true;
  const gatewayPassed = browserRuntimeEvidence?.gateway?.healthz?.status === 200
    && browserRuntimeEvidence?.gateway?.readyz?.status === 200
    && browserRuntimeEvidence?.gateway?.readiness?.output === true
    && browserRuntimeEvidence?.gateway?.readiness?.portal === true
    && browserRuntimeEvidence?.gateway?.readiness?.healthz === true
    && browserRuntimeEvidence?.gateway?.readiness?.readyz === true;
  return {
    "host-preflight": preflightPassed ? "pass" : "pending",
    [runtimeBootCheckId()]: gatewayPassed ? "pass" : "pending",
    ...Object.fromEntries(Object.keys(PENDING_RUNTIME_CHECKS).map((id) => [id, "pending"])),
    "runtime-performance": browserRuntimeEvidence?.install?.result === "pass"
      && browserRuntimeEvidence?.gateway?.result === "pass" ? "warn" : "pending"
  };
}

export function findNativeRisks(packages = {}) {
  const risks = [];
  for (const [path, metadata] of Object.entries(packages)) {
    if (!path.startsWith("node_modules/")) continue;
    const name = path.slice("node_modules/".length);
    const rule = RISK_RULES.find(({ pattern }) => pattern.test(name));
    if (!rule) continue;
    risks.push({ name, version: String(metadata.version ?? "unknown"), reason: rule.reason });
  }
  return risks.sort((left, right) => left.name.localeCompare(right.name));
}

export function findShrinkwrapRootDrift(manifest = {}, shrinkwrap = {}) {
  const root = shrinkwrap?.packages?.[""] ?? {};
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const missing = [];
  const mismatched = [];
  for (const section of sections) {
    const declared = manifest?.[section] ?? {};
    const locked = root?.[section] ?? {};
    for (const [name, version] of Object.entries(declared)) {
      if (!(name in locked)) missing.push({ section, name, version: String(version) });
      else if (String(locked[name]) !== String(version)) {
        mismatched.push({ section, name, manifest: String(version), shrinkwrap: String(locked[name]) });
      }
    }
  }
  return {
    lockfileVersion: Number(shrinkwrap?.lockfileVersion ?? 0),
    compatible: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched
  };
}

export function buildReport({
  packageName,
  manifest,
  pack,
  shrinkwrap,
  generatedAt,
  browserRuntimeEvidence,
  target
}) {
  if (!manifest?.version) throw new Error("The npm manifest is missing a version.");
  if (!pack?.integrity) throw new Error("The npm pack result is missing integrity metadata.");
  const reportTarget = normalizeReportTarget(target);
  if (browserRuntimeEvidence) {
    assertBrowserRuntimeEvidence(browserRuntimeEvidence);
    if (browserRuntimeEvidence.target.runtimeVersion !== reportTarget.runtimeVersion) {
      throw new Error("BrowserPod evidence runtime does not match the report target.");
    }
    if (browserRuntimeEvidence.target.browser !== reportTarget.browserBaseline) {
      throw new Error("BrowserPod evidence browser does not match the report baseline.");
    }
    if (browserRuntimeEvidence.artifact?.package !== packageName
      || browserRuntimeEvidence.artifact?.version !== manifest.version
      || browserRuntimeEvidence.artifact?.integrity !== pack.integrity) {
      throw new Error("BrowserPod evidence artifact does not match the inspected npm package.");
    }
  }

  const dependencies = manifest.dependencies ?? {};
  const nativeRiskDependencies = findNativeRisks(shrinkwrap?.packages);
  const shrinkwrapRootDrift = findShrinkwrapRootDrift(manifest, shrinkwrap);
  const hasLifecycleScript = Boolean(manifest.scripts?.preinstall || manifest.scripts?.install || manifest.scripts?.postinstall);
  const runtimeStatuses = deriveRuntimeClaimStatuses({ browserRuntimeEvidence });
  const bootCheckId = runtimeBootCheckId();

  return {
    schemaVersion: 1,
    generatedAt,
    status: runtimeStatuses[bootCheckId] === "pass" ? "partial" : "probing",
    target: reportTarget,
    artifact: {
      package: packageName,
      version: manifest.version,
      integrity: pack.integrity,
      nodeEngine: manifest.engines?.node ?? "unspecified",
      tarballBytes: pack.size ?? 0,
      unpackedBytes: pack.unpackedSize ?? 0,
      directDependencyCount: Object.keys(dependencies).length,
      nativeRiskDependencies,
      shrinkwrapRootConsistency: {
        lockfileVersion: shrinkwrapRootDrift.lockfileVersion,
        compatible: shrinkwrapRootDrift.compatible,
        missingCount: shrinkwrapRootDrift.missing.length,
        mismatchedCount: shrinkwrapRootDrift.mismatched.length,
        missingDevDependencyCount: shrinkwrapRootDrift.missing.filter((item) => item.section === "devDependencies").length
      }
    },
    evidence: browserRuntimeEvidence ? [{
      id: "browserpod-runtime",
      kind: "browser-runtime",
      capturedAt: browserRuntimeEvidence.capturedAt,
      path: `evidence/browserpod-openclaw-${browserRuntimeEvidence.artifact.version}.json`,
      sha256: evidenceDigest(browserRuntimeEvidence),
      summary: `BrowserPod ${browserRuntimeEvidence.target.runtimeVersion} installed exact OpenClaw ${browserRuntimeEvidence.artifact.version}, matched its SHA-512 lock integrity, returned HTTP 200 from /healthz and /readyz, and completed guest-supervisor shutdown in ${browserRuntimeEvidence.target.browser}; the portal is public and provider termination remains unavailable.`
    }] : [],
    checks: [
      {
        id: "artifact-pinned",
        label: "Exact upstream artifact",
        status: "pass",
        detail: `${packageName}@${manifest.version} is pinned by version and integrity.`
      },
      {
        id: "lifecycle-scripts",
        label: "Lifecycle scripts classified",
        status: hasLifecycleScript ? "warn" : "pass",
        detail: hasLifecycleScript
          ? "The artifact declares lifecycle scripts; the BrowserPod probe must capture their behavior without silently skipping them."
          : "No install lifecycle scripts are declared."
      },
      {
        id: "shrinkwrap-root-consistency",
        label: "Published shrinkwrap consistency",
        status: shrinkwrapRootDrift.compatible ? "pass" : "warn",
        detail: shrinkwrapRootDrift.compatible
          ? `The published package manifest matches shrinkwrap lockfile v${shrinkwrapRootDrift.lockfileVersion} at the root.`
          : `The published manifest has ${shrinkwrapRootDrift.missing.length} missing and ${shrinkwrapRootDrift.mismatched.length} mismatched root declarations in shrinkwrap lockfile v${shrinkwrapRootDrift.lockfileVersion}.`
      },
      {
        id: "native-dependencies",
        label: "Native dependency inventory",
        status: nativeRiskDependencies.length ? "warn" : "pass",
        detail: nativeRiskDependencies.length
          ? `${nativeRiskDependencies.length} platform-specific package variants require capability-scoped handling.`
          : "No known platform-specific packages were found in the lockfile."
      },
      {
        id: "host-preflight",
        label: "BrowserPod preflight",
        status: runtimeStatuses["host-preflight"],
        detail: browserRuntimeEvidence
          ? `BrowserPod ${browserRuntimeEvidence.target.runtimeVersion} booted Node ${browserRuntimeEvidence.preflight.node}; node:crypto verification and node:sqlite passed in ${browserRuntimeEvidence.target.browser}.`
          : "A dated BrowserPod evidence record has not been attached."
      },
      {
        id: bootCheckId,
        label: "OpenClaw BrowserPod boot",
        status: runtimeStatuses[bootCheckId],
        detail: browserRuntimeEvidence
          ? "The exact SHA-512 artifact reached Gateway readiness, returned HTTP 200 from /healthz and /readyz, and completed guest-supervisor shutdown in BrowserPod."
          : "This exact OpenClaw artifact has not booted in BrowserPod yet."
      },
      ...Object.entries(PENDING_RUNTIME_CHECKS).map(([id, detail]) => ({
        id,
        label: CHECK_LABELS[id],
        status: runtimeStatuses[id],
        detail
      })),
      {
        id: "runtime-performance",
        label: "Measured browser runtime cost",
        status: runtimeStatuses["runtime-performance"],
        detail: browserRuntimeEvidence
          ? `BrowserPod measured a ${(browserRuntimeEvidence.install.durationMs / 1000).toFixed(1)}s exact-artifact install and ${(browserRuntimeEvidence.gateway.durationMs / 1000).toFixed(1)}s Gateway readiness path; cold/warm distributions and storage footprint budgets are still required.`
          : "Cold/warm install time, filesystem footprint, and Gateway-ready latency have not been measured in BrowserPod."
      }
    ]
  };
}

export function assertReport(report) {
  const failures = [];
  if (report?.schemaVersion !== 1) failures.push("schemaVersion must be 1");
  if (!Number.isFinite(Date.parse(report?.generatedAt))) failures.push("generatedAt must be an ISO date-time");
  if (!["probing", "supported", "partial", "unsupported"].includes(report?.status)) failures.push("status is invalid");
  if (!report?.artifact?.package || !report?.artifact?.version || !report?.artifact?.integrity) failures.push("artifact identity is incomplete");
  try { normalizeReportTarget(report?.target); }
  catch (error) { failures.push(error instanceof Error ? error.message : "target is invalid"); }
  if (!Array.isArray(report?.evidence)) failures.push("evidence must be an array");
  if (!Array.isArray(report?.checks) || report.checks.length === 0) failures.push("checks must not be empty");
  if (report?.checks?.some((check) => !["pass", "warn", "fail", "pending"].includes(check.status))) failures.push("a check status is invalid");
  if (failures.length) throw new Error(`Invalid compatibility report: ${failures.join("; ")}`);
  return report;
}
