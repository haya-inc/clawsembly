import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { runBrowserPodOpenClawProbe } from "./browserpod-openclaw-probe.mjs";
import {
  TEST_OPENCLAW_ARTIFACT,
  createFakeBrowserPod,
  deferred,
  healthEvidenceLine,
  preflightEvidenceLine,
  supervisorExitTranscript,
  supervisorReadyTranscript
} from "../test-support/fake-browserpod.mjs";

const INTEGRITY = TEST_OPENCLAW_ARTIFACT.integrity;
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../compatibility/browserpod-evidence.schema.json", import.meta.url),
  "utf8"
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateEvidence = ajv.compile(evidenceSchema);

function fakeBrowserPod({
  lockIntegrity = INTEGRITY,
  cryptoVerify = true,
  sqlite = true,
  gatewayExitEarly = false
} = {}) {
  const gateway = deferred();
  let emitToGateway;
  return createFakeBrowserPod({
    missingFiles: "throw",
    onRun({ executable, args, options, emit, emitPortal, files }) {
      if (executable === "node" && args[0]?.endsWith("/clawsembly-preflight/probe.cjs")) {
        emit(preflightEvidenceLine({ cryptoVerify, sqlite }));
        return {};
      }
      if (executable === "npm") {
        files.set(`${options.cwd}/node_modules/openclaw/package.json`, JSON.stringify({ version: TEST_OPENCLAW_ARTIFACT.version }));
        files.set(`${options.cwd}/package-lock.json`, JSON.stringify({
          packages: { "node_modules/openclaw": { version: TEST_OPENCLAW_ARTIFACT.version, integrity: lockIntegrity } }
        }));
        emit("added openclaw\n");
        return {};
      }
      if (executable === "node" && args[0]?.endsWith("/supervisor-gateway.mjs")) {
        if (gatewayExitEarly) return {};
        emitToGateway = emit;
        queueMicrotask(() => {
          emit(supervisorReadyTranscript());
          emitPortal({ port: 18_789, url: "https://browserpod.example/session" });
        });
        return gateway.promise;
      }
      if (executable === "node" && args[0]?.endsWith("/clawsembly-health.mjs")) {
        emit(healthEvidenceLine());
        return {};
      }
      throw new Error(`unexpected fake BrowserPod command: ${executable}`);
    },
    onFileClose(path) {
      if (path.endsWith("/stop-gateway.json")) {
        emitToGateway(supervisorExitTranscript());
        gateway.resolve({});
      }
    }
  });
}

test("captures exact-artifact BrowserPod Gateway readiness without serializing credentials", async () => {
  const fake = fakeBrowserPod();
  let clock = Date.parse("2026-07-12T02:00:00.000Z");
  const output = [];
  const session = await runBrowserPodOpenClawProbe({
    BrowserPod: fake.BrowserPod,
    apiKey: "browserpod-owner-secret",
    artifact: TEST_OPENCLAW_ARTIFACT,
    nodeEngine: ">=22.19.0",
    browser: "Chromium 140.0.0",
    storageKey: "clawsembly-openclaw-2026.6.11",
    gatewayToken: "gateway-ephemeral-secret",
    supervisorNonceFactory: () => "supervisor_nonce_123456",
    onOutput: (event) => output.push(event),
    now: () => { clock += 100; return clock; }
  });

  assert.equal(session.evidence.target.runtime, "browserpod");
  assert.equal(validateEvidence(session.evidence), true, JSON.stringify(validateEvidence.errors));
  assert.equal(session.evidence.target.runtimeVersion, "2.12.1");
  assert.equal(session.evidence.artifact.integrity, INTEGRITY);
  assert.equal(session.evidence.install.integrityMatched, true);
  assert.deepEqual(session.evidence.gateway.readiness, {
    output: true,
    portal: true,
    healthz: true,
    readyz: true
  });
  assert.deepEqual(session.evidence.gateway.termination, {
    mode: "guest-supervisor",
    result: "pass",
    durationMs: 100,
    providerProcessTermination: false,
    hardDispose: false
  });
  assert.deepEqual(session.evidence.limitations, [
    "interactive-input-unavailable",
    "provider-process-termination-unavailable",
    "hard-dispose-unavailable",
    "portal-is-public-url"
  ]);
  assert.equal(JSON.stringify(session.evidence).includes("browserpod-owner-secret"), false);
  assert.equal(JSON.stringify(session.evidence).includes("gateway-ephemeral-secret"), false);
  assert.deepEqual(new Set(output.map((event) => event.phase)), new Set(["preflight", "install", "gateway", "health"]));
  assert.equal(fake.calls.some(([name, call]) => name === "run"
    && call.executable === "npm" && call.args.includes("openclaw@2026.6.11")), true);
  const supervisorConfig = JSON.parse(fake.files.get(
    "/workspace/clawsembly-probe/supervision/supervisor-gateway.json"
  ));
  assert.equal(supervisorConfig.args.includes("--auth") && supervisorConfig.args.includes("token"), true);
  assert.equal(JSON.stringify(supervisorConfig).includes("gateway-ephemeral-secret"), false);
  assert.deepEqual(session.dispose(), {
    complete: false,
    reason: "BrowserPod 2.12.1 exposes no documented pod or process termination",
    activeTaskIds: []
  });
  assert.equal(session.gatewayTask.status, "completed");
});

test("rejects a package-lock integrity mismatch before starting the Gateway", async () => {
  const fake = fakeBrowserPod({ lockIntegrity: `sha512-${"B".repeat(86)}==` });
  await assert.rejects(
    runBrowserPodOpenClawProbe({
      BrowserPod: fake.BrowserPod,
      apiKey: "browserpod-owner-secret",
      artifact: TEST_OPENCLAW_ARTIFACT,
      nodeEngine: ">=22.19.0",
      browser: "Chromium 140.0.0",
      gatewayToken: "gateway-ephemeral-secret"
    }),
    (error) => error.code === "artifact_mismatch"
  );
  assert.equal(fake.calls.some(([name, call]) => name === "run"
    && call.executable === "node"
    && call.args.includes("/workspace/clawsembly-probe/node_modules/openclaw/openclaw.mjs")), false);
});

test("rejects a failed crypto preflight before installing OpenClaw", async () => {
  const fake = fakeBrowserPod({ cryptoVerify: false });
  await assert.rejects(
    runBrowserPodOpenClawProbe({
      BrowserPod: fake.BrowserPod,
      apiKey: "browserpod-owner-secret",
      artifact: TEST_OPENCLAW_ARTIFACT,
      nodeEngine: ">=22.19.0",
      browser: "Chromium 140.0.0",
      gatewayToken: "gateway-ephemeral-secret"
    }),
    (error) => error.code === "preflight_failed"
  );
  assert.equal(fake.calls.some(([name, call]) => name === "run" && call.executable === "npm"), false);
});

test("fails immediately when the Gateway supervisor exits before readiness", async () => {
  const fake = fakeBrowserPod({ gatewayExitEarly: true });
  await assert.rejects(
    runBrowserPodOpenClawProbe({
      BrowserPod: fake.BrowserPod,
      apiKey: "browserpod-owner-secret",
      artifact: TEST_OPENCLAW_ARTIFACT,
      nodeEngine: ">=22.19.0",
      browser: "Chromium 140.0.0",
      gatewayToken: "gateway-ephemeral-secret"
    }),
    (error) => error.code === "supervisor_exited"
  );
});
