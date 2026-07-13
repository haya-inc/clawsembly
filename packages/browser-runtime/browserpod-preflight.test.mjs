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
          onPortal() {},
          async createCustomTerminal(terminalOptions) {
            calls.push(["terminal", { cols: terminalOptions.cols, rows: terminalOptions.rows }]);
            return { emit: terminalOptions.onOutput };
          },
          async run(command, args, runOptions) {
            calls.push(["run", { command, args, echo: runOptions.echo }]);
            const bytes = new TextEncoder().encode(`${EVIDENCE_PREFIX}${JSON.stringify(evidence)}\n`);
            runOptions.terminal.emit(bytes.buffer);
            return {};
          },
          async createDirectory() {},
          async createFile() { return { async write() {}, async close() {} }; },
          async openFile() { return { async getSize() { return 0; }, async read() { return ""; }, async close() {} }; }
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
    runtimeVersion: "2.12.1",
    browserLocal: true,
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

test("classifies malformed preflight evidence as invalid output", async () => {
  const BrowserPod = {
    async boot() {
      return {
        onPortal() {},
        async createCustomTerminal(options) {
          return { emit: options.onOutput };
        },
        async run(_command, _args, options) {
          options.terminal.emit(new TextEncoder().encode(`${EVIDENCE_PREFIX}{not-json\n`).buffer);
          return {};
        },
        async createDirectory() {},
        async createFile() { return { async write() {}, async close() {} }; },
        async openFile() { return { async getSize() { return 0; }, async read() { return ""; }, async close() {} }; }
      };
    }
  };
  await assert.rejects(
    runBrowserPodPreflight({ BrowserPod, apiKey: "runtime-secret" }),
    (error) => error.code === "preflight_output_invalid"
  );
});
