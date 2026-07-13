import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { EVIDENCE_PREFIX } from "./browserpod-preflight.mjs";
import {
  BROWSERPOD_HEALTH_PREFIX,
  runBrowserPodOpenClawProbe
} from "./browserpod-openclaw-probe.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;
const evidenceSchema = JSON.parse(readFileSync(
  new URL("../compatibility/browserpod-evidence.schema.json", import.meta.url),
  "utf8"
));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateEvidence = ajv.compile(evidenceSchema);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeBrowserPod({
  lockIntegrity = INTEGRITY,
  cryptoVerify = true,
  sqlite = true,
  gatewayExitEarly = false
} = {}) {
  const calls = [];
  const files = new Map();
  const portals = [];
  const gateway = deferred();
  let gatewayTerminal;
  const emit = (terminal, text) => {
    terminal.emit(new TextEncoder().encode(text).buffer);
  };
  return {
    calls,
    files,
    gateway,
    BrowserPod: {
      async boot(options) {
        calls.push(["boot", options]);
        return {
          onPortal(handler) { portals.push(handler); },
          async createCustomTerminal(options) { return { emit: options.onOutput }; },
          async run(executable, args, options) {
            calls.push(["run", { executable, args, env: options.env, cwd: options.cwd }]);
            if (executable === "node" && args[0]?.endsWith("/clawsembly-preflight/probe.cjs")) {
              emit(options.terminal, `${EVIDENCE_PREFIX}${JSON.stringify({
                node: "22.19.0",
                platform: "linux",
                arch: "wasm32",
                cryptoVerify,
                sqlite
              })}\n`);
              return {};
            }
            if (executable === "npm") {
              files.set(`${options.cwd}/node_modules/openclaw/package.json`, JSON.stringify({ version: "2026.6.11" }));
              files.set(`${options.cwd}/package-lock.json`, JSON.stringify({
                packages: { "node_modules/openclaw": { version: "2026.6.11", integrity: lockIntegrity } }
              }));
              emit(options.terminal, "added openclaw\n");
              return {};
            }
            if (executable === "node" && args[0]?.endsWith("/supervisor-gateway.mjs")) {
              if (gatewayExitEarly) return {};
              gatewayTerminal = options.terminal;
              queueMicrotask(() => {
                emit(options.terminal, "[clawsembly-supervisor]{\"event\":\"ready\"}\n[gateway] ready\n");
                for (const handler of portals) {
                  handler({ port: 18_789, url: "https://browserpod.example/session" });
                }
              });
              return gateway.promise;
            }
            if (executable === "node" && args[0]?.endsWith("/clawsembly-health.mjs")) {
              emit(options.terminal, `${BROWSERPOD_HEALTH_PREFIX}${JSON.stringify({
                healthz: { status: 200, body: "{\"ok\":true}" },
                readyz: { status: 200, body: "{\"ready\":true}" }
              })}\n`);
              return {};
            }
            throw new Error(`unexpected fake BrowserPod command: ${executable}`);
          },
          async createDirectory(path, options) { calls.push(["mkdir", { path, options }]); },
          async createFile(path) {
            let text = "";
            return {
              async write(value) { text += value; files.set(path, text); },
              async close() {
                if (path.endsWith("/stop-gateway.json")) {
                  emit(gatewayTerminal, "[clawsembly-supervisor]{\"event\":\"exit\",\"requestedStop\":true,\"code\":0,\"signal\":null,\"error\":false}\n");
                  gateway.resolve({});
                }
              }
            };
          },
          async openFile(path) {
            const text = files.get(path);
            if (text === undefined) throw new Error(`missing fake file: ${path}`);
            return {
              async getSize() { return text.length; },
              async read(length) { return text.slice(0, length); },
              async close() {}
            };
          }
        };
      }
    }
  };
}

test("captures exact-artifact BrowserPod Gateway readiness without serializing credentials", async () => {
  const fake = fakeBrowserPod();
  let clock = Date.parse("2026-07-12T02:00:00.000Z");
  const output = [];
  const session = await runBrowserPodOpenClawProbe({
    BrowserPod: fake.BrowserPod,
    apiKey: "browserpod-owner-secret",
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
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
      artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
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
      artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
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
      artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
      browser: "Chromium 140.0.0",
      gatewayToken: "gateway-ephemeral-secret"
    }),
    (error) => error.code === "supervisor_exited"
  );
});
