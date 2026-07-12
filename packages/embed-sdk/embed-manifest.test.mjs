import assert from "node:assert/strict";
import test from "node:test";

import { assertVerifiedLaunch, createEmbedManifest } from "./embed-manifest.mjs";

const report = {
  generatedAt: "2026-07-12T00:00:00.000Z",
  status: "partial",
  target: { runtime: "webcontainer" },
  artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-exact" }
};

test("records BrowserPod adoption while blocking evidence from another runtime", () => {
  const manifest = createEmbedManifest({
    report,
    capabilities: [{ capability: "provider.openai.responses", scope: "model:gpt-5.6-luna", maxCalls: 4 }]
  });
  assert.equal(manifest.runtime, "browserpod");
  assert.equal(manifest.launchable, false);
  assert.deepEqual(manifest.blockers, [
    "report targets webcontainer, not browserpod",
    "report runtime version is unreported, not 2.12.1",
    "report status is partial, not supported"
  ]);
  assert.throws(() => assertVerifiedLaunch(manifest), /verified BrowserPod launch blocked/u);
});

test("authorizes only a supported report captured against BrowserPod", () => {
  const manifest = createEmbedManifest({
    report: { ...report, status: "supported", target: { runtime: "browserpod", runtimeVersion: "2.12.1" } },
    capabilities: [
      { capability: "identity.sign", scope: "challenge:gateway" },
      { capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 2 }
    ]
  });
  assert.equal(assertVerifiedLaunch(manifest), manifest);
  assert.equal(manifest.launchable, true);
  assert.equal(manifest.runtimeVersion, "2.12.1");
  assert.equal(manifest.evidence.verifiedForRuntime, true);
  assert.equal(Object.isFrozen(manifest.capabilities), true);
});

test("blocks supported evidence from another BrowserPod version", () => {
  const manifest = createEmbedManifest({
    report: { ...report, status: "supported", target: { runtime: "browserpod", runtimeVersion: "2.11.0" } }
  });
  assert.equal(manifest.launchable, false);
  assert.deepEqual(manifest.blockers, ["report runtime version is 2.11.0, not 2.12.1"]);
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
    /exact OpenClaw artifact/u
  );
});
