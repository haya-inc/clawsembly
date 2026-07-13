import assert from "node:assert/strict";
import test from "node:test";

import { EVIDENCE_PREFIX, runBrowserPodPreflight } from "./browserpod-preflight.mjs";
import { createFakeBrowserPod, preflightEvidenceLine } from "../test-support/fake-browserpod.mjs";

function fakeBrowserPod(evidence) {
  return createFakeBrowserPod({
    onRun({ emit }) {
      emit(preflightEvidenceLine(evidence));
      return {};
    }
  });
}

test("proves the pinned Node baseline without exposing the API key to the guest command", async () => {
  const fake = fakeBrowserPod({
    node: "22.19.0",
    platform: "linux",
    arch: "wasm32",
    cryptoVerify: true,
    sqlite: true
  });
  const evidence = await runBrowserPodPreflight({
    BrowserPod: fake.BrowserPod,
    apiKey: "runtime-secret",
    storageKey: "test-runtime",
    nodeEngine: ">=22.19.0"
  });

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    runtime: "browserpod",
    runtimeVersion: "2.12.1",
    browserLocal: true,
    node: "22.19.0",
    nodeEngine: ">=22.19.0",
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
    },
    diagnostics: {}
  });
  assert.deepEqual(fake.calls[0], ["boot", {
    apiKey: "runtime-secret",
    nodeVersion: "22",
    storageKey: "test-runtime"
  }]);
  const runCall = fake.calls.find(([name]) => name === "run");
  assert.equal(JSON.stringify(runCall).includes("runtime-secret"), false);
});

test("fails closed when the provided Node build is older than the artifact requires", async () => {
  const fake = fakeBrowserPod({
    node: "22.18.0",
    platform: "linux",
    arch: "wasm32",
    cryptoVerify: true,
    sqlite: true
  });
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod: fake.BrowserPod, apiKey: "runtime-secret", nodeEngine: ">=22.19.0" }),
    (error) => error.code === "node_baseline_unsatisfied"
      && /does not satisfy the artifact's >=22\.19\.0 baseline/u.test(error.message)
  );
});

test("accepts an older artifact baseline that the provided Node satisfies", async () => {
  const fake = fakeBrowserPod({
    node: "22.15.0",
    platform: "linux",
    arch: "wasm32",
    cryptoVerify: true,
    sqlite: true
  });
  const evidence = await runBrowserPodPreflight({
    BrowserPod: fake.BrowserPod,
    apiKey: "runtime-secret",
    nodeEngine: ">=22.14.0"
  });
  assert.equal(evidence.node, "22.15.0");
  assert.equal(evidence.nodeEngine, ">=22.14.0");
  assert.equal(evidence.checks.nodeBaseline, true);
});

test("rejects unsupported engine declarations before any metered boot", async () => {
  for (const nodeEngine of [undefined, "unspecified", "^22.19.0", ">=22.19.0 <23", 22]) {
    let booted = false;
    await assert.rejects(
      runBrowserPodPreflight({
        BrowserPod: { async boot() { booted = true; return {}; } },
        apiKey: "runtime-secret",
        nodeEngine
      }),
      (error) => error.code === "node_baseline_unsupported"
    );
    assert.equal(booted, false);
  }
});

test("requires an explicit metered-runtime credential before boot", async () => {
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod: { boot() {} }, apiKey: "" }),
    /API key is required/u
  );
});

test("classifies malformed preflight evidence as invalid output", async () => {
  const fake = createFakeBrowserPod({
    onRun({ emit }) {
      emit(`${EVIDENCE_PREFIX}{not-json\n`);
      return {};
    }
  });
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod: fake.BrowserPod, apiKey: "runtime-secret", nodeEngine: ">=22.19.0" }),
    (error) => error.code === "preflight_output_invalid"
  );
});
