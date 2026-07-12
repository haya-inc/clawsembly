import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const schema = JSON.parse(readFileSync(
  new URL("../browserpod-evidence.schema.json", import.meta.url),
  "utf8"
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

test("BrowserPod evidence schema rejects credentials and incomplete readiness", () => {
  const integrity = `sha512-${"A".repeat(86)}==`;
  const evidence = {
    schemaVersion: 1,
    capturedAt: "2026-07-12T02:00:00.000Z",
    source: "owner-authorized BrowserPod probe",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browser: "Chromium 140.0.0", browserLocal: true },
    artifact: { package: "openclaw", version: "2026.6.11", integrity },
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
      lockIntegrity: integrity,
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
      outputTruncated: false
    },
    limitations: [
      "interactive-input-unavailable",
      "provider-process-termination-unavailable",
      "hard-dispose-unavailable",
      "portal-is-public-url"
    ]
  };
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(validate({
    ...evidence,
    gatewayToken: "must-never-be-serialized"
  }), false);
  assert.equal(validate({
    ...evidence,
    gateway: {
      ...evidence.gateway,
      readiness: { ...evidence.gateway.readiness, readyz: false }
    }
  }), false);
});
