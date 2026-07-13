import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { assertVerifiedLaunch, createEmbedManifest } from "./embed-manifest.mjs";
import { loadVerifiedCompatibilityReport } from "./report-loader.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

const report = {
  generatedAt: "2026-07-12T00:00:00.000Z",
  status: "partial",
  target: { runtime: "remote" },
  artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY }
};

async function verifiedSupportedReport() {
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "supported",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    evidence: [{
      id: "browserpod-runtime",
      kind: "browser-runtime",
      path: "evidence/browserpod-openclaw-2026.6.11.json",
      sha256: "a".repeat(64)
    }],
    checks: [{ id: "runtime", status: "pass" }]
  };
  const body = `${JSON.stringify(value)}\n`;
  const sha256 = createHash("sha256").update(body).digest("hex");
  return loadVerifiedCompatibilityReport({
    url: "https://example.com/compatibility.json",
    sha256,
    maxAgeMs: 24 * 60 * 60 * 1_000,
    artifact: value.artifact,
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
  }, {
    fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } })
  });
}

test("records BrowserPod adoption while blocking evidence from another runtime", () => {
  const manifest = createEmbedManifest({
    report,
    capabilities: [{ capability: "provider.openai.responses", scope: "model:gpt-5.6-luna", maxCalls: 4 }]
  });
  assert.equal(manifest.runtime, "browserpod");
  assert.equal(manifest.launchable, false);
  assert.deepEqual(manifest.blockers, [
    "report source and SHA-256 are unverified",
    "report targets remote, not browserpod",
    "report runtime version is unreported, not 2.12.1",
    "report status is partial, not supported"
  ]);
  assert.throws(() => assertVerifiedLaunch(manifest), /verified BrowserPod launch blocked/u);
});

test("authorizes only a digest-verified supported report captured against BrowserPod", async () => {
  const manifest = createEmbedManifest({
    report: await verifiedSupportedReport(),
    capabilities: [
      { capability: "identity.sign", scope: "challenge:gateway" },
      { capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 2 }
    ]
  });
  assert.equal(assertVerifiedLaunch(manifest), manifest);
  assert.equal(manifest.launchable, true);
  assert.equal(manifest.runtimeVersion, "2.12.1");
  assert.equal(manifest.evidence.verifiedForRuntime, true);
  assert.equal(manifest.evidence.reportVerified, true);
  assert.match(manifest.evidence.reportSha256, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(manifest.capabilities), true);
});

test("a caller-created supported object cannot authorize launch", () => {
  const manifest = createEmbedManifest({
    report: { ...report, status: "supported", target: { runtime: "browserpod", runtimeVersion: "2.12.1" } }
  });
  assert.equal(manifest.launchable, false);
  assert.deepEqual(manifest.blockers, ["report source and SHA-256 are unverified"]);
  assert.throws(() => assertVerifiedLaunch(manifest), /source and SHA-256 are unverified/u);
});

test("blocks supported evidence from another BrowserPod version", () => {
  const manifest = createEmbedManifest({
    report: { ...report, status: "supported", target: { runtime: "browserpod", runtimeVersion: "2.11.0" } }
  });
  assert.equal(manifest.launchable, false);
  assert.deepEqual(manifest.blockers, [
    "report source and SHA-256 are unverified",
    "report runtime version is 2.11.0, not 2.12.1"
  ]);
});

test("rejects duplicate grants and non-BrowserPod embedded runtimes", () => {
  assert.throws(() => createEmbedManifest({
    report,
    capabilities: [
      { capability: "storage.restore", scope: "workspace:primary" },
      { capability: "storage.restore", scope: "workspace:primary" }
    ]
  }), /must be unique/u);
  assert.throws(() => createEmbedManifest({ report, runtime: "remote" }), /adopted embedded runtime/u);
});

test("rejects reports without exact artifact integrity", () => {
  assert.throws(
    () => createEmbedManifest({ report: { ...report, artifact: { ...report.artifact, integrity: "latest" } } }),
    /exact upstream artifact/u
  );
  assert.throws(
    () => createEmbedManifest({ report: { ...report, artifact: { ...report.artifact, integrity: "sha512-not-base64-" } } }),
    /exact upstream artifact/u
  );
});

test("rejects malformed upstream package names without weakening exactness", () => {
  for (const forged of ["../openclaw", "OpenClaw", "openclaw claw", `x${"a".repeat(214)}`, "", 7]) {
    assert.throws(
      () => createEmbedManifest({ report: { ...report, artifact: { ...report.artifact, package: forged } } }),
      /exact upstream artifact/u
    );
  }
});

test("identifies a second upstream artifact through the same fail-closed path", () => {
  const manifest = createEmbedManifest({
    report: { ...report, artifact: { ...report.artifact, package: "clawsembly-hello-agent" } }
  });
  assert.equal(manifest.artifact.package, "clawsembly-hello-agent");
  assert.equal(manifest.launchable, false);
  assert.throws(() => assertVerifiedLaunch(manifest), /verified BrowserPod launch blocked/u);
});

test("rejects a forged launchable manifest with inconsistent evidence", async () => {
  const manifest = createEmbedManifest({
    report: await verifiedSupportedReport()
  });
  assert.throws(
    () => assertVerifiedLaunch({ ...manifest, evidence: { ...manifest.evidence, reportStatus: "partial" } }),
    /evidence is inconsistent/u
  );
});
