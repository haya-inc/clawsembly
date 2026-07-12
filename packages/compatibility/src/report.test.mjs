import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReport,
  buildReport,
  deriveRuntimeClaimStatuses,
  evidenceDigest,
  findNativeRisks,
  findShrinkwrapRootDrift,
  normalizeDirectDependencies,
  normalizeReportTarget
} from "./report.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

function browserPodEvidence() {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-12T02:00:00.000Z",
    source: "owner-authorized BrowserPod probe",
    target: {
      runtime: "browserpod",
      runtimeVersion: "2.12.1",
      browser: "Chromium 140.0.0",
      browserLocal: true
    },
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    preflight: {
      node: "22.19.0",
      platform: "linux",
      arch: "wasm32",
      checks: { nodeBaseline: true, cryptoVerify: true, sqlite: true },
      lifecycle: {
        browserLocal: true,
        nodeMajor: 22,
        persistentFilesystem: true,
        portals: true,
        portalVisibility: "public-url",
        fileApi: true,
        interactiveInput: false,
        processTermination: false,
        hardDispose: false
      }
    },
    install: {
      result: "pass",
      command: "npm install --save-exact openclaw@<version>",
      durationMs: 42_000,
      installedVersion: "2026.6.11",
      lockIntegrity: INTEGRITY,
      integrityMatched: true,
      outputTruncated: false
    },
    gateway: {
      result: "pass",
      port: 18_789,
      bind: "loopback",
      auth: "token",
      taskId: "browserpod-task-3",
      durationMs: 9_000,
      readiness: { output: true, portal: true, healthz: true, readyz: true },
      portal: { port: 18_789, url: "https://browserpod.example/session", visibility: "public-url" },
      healthz: { status: 200, body: "{\"ok\":true}" },
      readyz: { status: 200, body: "{\"ready\":true}" },
      termination: {
        mode: "guest-supervisor",
        result: "pass",
        durationMs: 250,
        providerProcessTermination: false,
        hardDispose: false
      },
      outputTruncated: false
    },
    limitations: [
      "interactive-input-unavailable",
      "provider-process-termination-unavailable",
      "hard-dispose-unavailable",
      "portal-is-public-url"
    ]
  };
}

function staticInput(overrides = {}) {
  return {
    packageName: "openclaw",
    generatedAt: "2026-07-12T00:00:00.000Z",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    manifest: { version: "2026.6.11", dependencies: {} },
    pack: { integrity: "sha512-test", size: 10, unpackedSize: 20 },
    shrinkwrap: { packages: {} },
    ...overrides
  };
}

test("evidenceDigest is stable across object key order", () => {
  assert.equal(
    evidenceDigest({ nested: { second: 2, first: 1 }, items: [{ beta: true, alpha: false }] }),
    evidenceDigest({ items: [{ alpha: false, beta: true }], nested: { first: 1, second: 2 } })
  );
});

test("compatibility targets are BrowserPod-only and version-bound", () => {
  assert.deepEqual(normalizeReportTarget({ runtimeVersion: "2.12.1" }), {
    runtime: "browserpod",
    runtimeVersion: "2.12.1",
    browserBaseline: "Desktop Chromium; Firefox and WebKit pending BrowserPod evidence."
  });
  assert.throws(() => normalizeReportTarget({ runtime: "remote", runtimeVersion: "1" }), /BrowserPod-only/u);
  assert.throws(() => normalizeReportTarget({ runtime: "browserpod" }), /exact runtimeVersion/u);
});

test("deriveRuntimeClaimStatuses fails closed without BrowserPod evidence", () => {
  const statuses = deriveRuntimeClaimStatuses();
  assert.equal(statuses["host-preflight"], "pending");
  assert.equal(statuses["openclaw-browserpod-boot"], "pending");
  assert.equal(statuses["gateway-handshake"], "pending");
  assert.equal(statuses["runtime-performance"], "pending");
});

test("findNativeRisks classifies platform variants", () => {
  const risks = findNativeRisks({
    "node_modules/ws": { version: "8.0.0" },
    "node_modules/@lydell/node-pty-linux-x64": { version: "1.2.0" },
    "node_modules/sqlite-vec-darwin-arm64": { version: "0.1.9" }
  });
  assert.deepEqual(risks.map((risk) => risk.name), ["@lydell/node-pty-linux-x64", "sqlite-vec-darwin-arm64"]);
});

test("findShrinkwrapRootDrift detects root validation failures", () => {
  const drift = findShrinkwrapRootDrift({ dependencies: { ws: "8.21.0" } }, {
    lockfileVersion: 3,
    packages: { "": { dependencies: { ws: "8.20.0" } } }
  });
  assert.equal(drift.compatible, false);
  assert.equal(drift.mismatched[0].name, "ws");
});

test("normalizeDirectDependencies preserves exact specs in stable name order", () => {
  assert.deepEqual(normalizeDirectDependencies(
    { zod: "4.4.3", "@openclaw/ai": "2026.7.1-beta.5" },
    {
      "node_modules/@openclaw/ai": { version: "2026.7.1-beta.5", integrity: "sha512-ai" },
      "node_modules/zod": { version: "4.4.3", integrity: "sha512-zod" }
    }
  ), [
    {
      name: "@openclaw/ai",
      spec: "2026.7.1-beta.5",
      resolvedVersion: "2026.7.1-beta.5",
      integrity: "sha512-ai"
    },
    { name: "zod", spec: "4.4.3", resolvedVersion: "4.4.3", integrity: "sha512-zod" }
  ]);
  assert.throws(() => normalizeDirectDependencies({ invalid: "" }), /exact declared spec/u);
});

test("buildReport emits a BrowserPod-only probing report", () => {
  const report = buildReport(staticInput());
  assert.equal(report.target.runtime, "browserpod");
  assert.equal(report.status, "probing");
  assert.deepEqual(report.artifact.directDependencies, []);
  assert.equal(report.evidence.length, 0);
  assert.equal(report.checks.find((check) => check.id === "openclaw-browserpod-boot")?.status, "pending");
  assert.doesNotThrow(() => assertReport(report));
});

test("buildReport attaches exact BrowserPod readiness evidence", () => {
  const evidence = browserPodEvidence();
  const report = buildReport(staticInput({
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Chromium 140.0.0" },
    pack: { integrity: INTEGRITY, size: 10, unpackedSize: 20 },
    browserRuntimeEvidence: evidence
  }));
  assert.equal(report.status, "partial");
  assert.equal(report.evidence[0].id, "browserpod-runtime");
  assert.equal(report.evidence[0].sha256, evidenceDigest(evidence));
  assert.equal(report.checks.find((check) => check.id === "host-preflight")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "openclaw-browserpod-boot")?.status, "pass");
  assert.equal(report.checks.find((check) => check.id === "gateway-handshake")?.status, "pending");
  assert.equal(report.checks.find((check) => check.id === "runtime-performance")?.status, "warn");
});

test("buildReport rejects mismatched BrowserPod evidence", () => {
  assert.throws(() => buildReport(staticInput({ browserRuntimeEvidence: browserPodEvidence() })), /browser does not match/u);
});

test("assertReport rejects unsupported status values", () => {
  assert.throws(() => assertReport({ schemaVersion: 1, generatedAt: "bad", status: "green" }), /Invalid compatibility report/u);
});
