import assert from "node:assert/strict";
import test from "node:test";

import { EVIDENCE_PREFIX, runBrowserPodPreflight } from "./browserpod-preflight.mjs";

function fakeBrowserPod(evidence) {
  const calls = [];
  return {
    calls,
    BrowserPod: {
      async boot(options) {
        calls.push(["boot", options]);
        return {
          async createCustomTerminal(options) {
            calls.push(["terminal", { cols: options.cols, rows: options.rows }]);
            return { emit: options.onOutput };
          },
          async run(command, args, options) {
            calls.push(["run", { command, args, echo: options.echo }]);
            const bytes = new TextEncoder().encode(`${EVIDENCE_PREFIX}${JSON.stringify(evidence)}\n`);
            options.terminal.emit(bytes.buffer);
            return {};
          }
        };
      }
    }
  };
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
    storageKey: "test-runtime"
  });

  assert.deepEqual(evidence, {
    schemaVersion: 1,
    runtime: "browserpod",
    browserLocal: true,
    node: "22.19.0",
    platform: "linux",
    arch: "wasm32",
    checks: { nodeBaseline: true, cryptoVerify: true, sqlite: true },
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

test("fails closed when the provided Node 22 build is older than OpenClaw requires", async () => {
  const fake = fakeBrowserPod({
    node: "22.18.0",
    platform: "linux",
    arch: "wasm32",
    cryptoVerify: true,
    sqlite: true
  });
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod: fake.BrowserPod, apiKey: "runtime-secret" }),
    /does not satisfy the pinned 22\.19\+ baseline/u
  );
});

test("requires an explicit metered-runtime credential before boot", async () => {
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod: { boot() {} }, apiKey: "" }),
    /API key is required/u
  );
});
