import assert from "node:assert/strict";
import test from "node:test";

import { classifyDependencyPackage } from "./dependency-risk.mjs";

const dependency = {
  name: "example-network-tool",
  change: "added",
  declaredSpec: "1.2.3",
  resolvedVersion: "1.2.3",
  integrity: `sha512-${"A".repeat(86)}==`
};

test("classifies exact artifact signals without executing package scripts", () => {
  const result = classifyDependencyPackage({
    dependency,
    manifest: {
      name: dependency.name,
      version: dependency.resolvedVersion,
      scripts: { install: "node install.js", test: "node --test" }
    },
    files: [
      { path: "binding.gyp", size: 10 },
      { path: "runtime.wasm", size: 20 },
      {
        path: "index.mjs",
        size: 100,
        contents: 'import fs from "node:fs"; import { spawn } from "child_process"; import OpenAI from "openai"; fetch("https://example.invalid"); process.env.TOKEN; WebAssembly.instantiate(bytes);'
      }
    ]
  });
  assert.deepEqual(result.signals.lifecycleScripts, [{ name: "install", command: "node install.js" }]);
  assert.deepEqual(result.signals.nativeArtifacts, ["binding.gyp"]);
  assert.deepEqual(result.signals.wasmArtifacts, ["runtime.wasm"]);
  assert.deepEqual(result.signals.nodeBuiltins, ["child_process", "fs"]);
  assert.deepEqual(result.signals.networkApis, ["fetch", "openai"]);
  assert.deepEqual(result.signals.sourceSignals, ["process.env", "WebAssembly"]);
  assert.deepEqual(result.signals.browserCapabilities, [
    "environment",
    "filesystem",
    "install-script",
    "native-code",
    "network",
    "subprocess",
    "wasm"
  ]);
});

test("rejects a packed manifest with a different exact identity", () => {
  assert.throws(() => classifyDependencyPackage({
    dependency,
    manifest: { name: dependency.name, version: "1.2.4" },
    files: []
  }), /identity drift/u);
});

test("marks an explicitly budget-limited source scan as truncated", () => {
  const result = classifyDependencyPackage({
    dependency,
    manifest: { name: dependency.name, version: dependency.resolvedVersion },
    files: [],
    scanTruncated: true
  });
  assert.equal(result.scan.truncated, true);
});
