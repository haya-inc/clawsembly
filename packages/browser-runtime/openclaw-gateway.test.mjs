import assert from "node:assert/strict";
import test from "node:test";

import { COOPERATIVE_SUPERVISOR_PREFIX } from "./cooperative-process.mjs";
import {
  BROWSERPOD_HEALTH_PREFIX,
  BROWSERPOD_HEALTH_SOURCE,
  createVerifiedOpenClawGateway,
  parseBrowserPodHealthEvidence
} from "./openclaw-gateway.mjs";

const ARTIFACT = Object.freeze({
  package: "openclaw",
  version: "2026.6.11",
  integrity: `sha512-${"A".repeat(86)}==`
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function runtimeFixture({ healthStatus = "completed" } = {}) {
  const files = new Map();
  const supervisorCompletion = deferred();
  let supervisorTranscript = `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}\n[gateway] ready\n`;
  let supervisorStatus = "running";
  const supervisorListeners = new Set();
  const supervisorTask = {
    id: "gateway-task-1",
    get status() { return supervisorStatus; },
    get transcript() { return supervisorTranscript; },
    outputTruncated: false,
    onOutput(listener, options = {}) {
      supervisorListeners.add(listener);
      if (options.replay !== false && supervisorTranscript) listener(supervisorTranscript);
      return () => supervisorListeners.delete(listener);
    },
    wait() { return supervisorCompletion.promise; },
    waitForOutput(needle) {
      return supervisorTranscript.includes(needle)
        ? Promise.resolve(supervisorTranscript)
        : Promise.reject(new Error(`missing ${needle}`));
    }
  };
  const healthTranscript = `${BROWSERPOD_HEALTH_PREFIX}${JSON.stringify({
    healthz: { status: 200, body: "{\"ok\":true}" },
    readyz: { status: 200, body: "{\"ready\":true}" }
  })}\n`;
  const healthTask = {
    id: "health-task-1",
    status: healthStatus,
    transcript: healthTranscript,
    outputTruncated: false,
    onOutput(listener) { listener(healthTranscript); return () => true; },
    async wait() { return { status: healthStatus, outputBytes: healthTranscript.length, outputTruncated: false }; }
  };
  const runtime = {
    provider: "browserpod",
    files,
    async createDirectory() {},
    async writeTextFile(path, source) {
      files.set(path, source);
      if (path.endsWith("/stop-gateway.json")) {
        supervisorTranscript += `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"exit","requestedStop":true,"code":0,"signal":null,"error":false}\n`;
        for (const listener of supervisorListeners) listener(supervisorTranscript);
        supervisorStatus = "completed";
        supervisorCompletion.resolve({ status: "completed", outputBytes: supervisorTranscript.length, outputTruncated: false });
      }
    },
    async start(command) {
      if (command.args[0]?.endsWith("/supervisor-gateway.mjs")) return supervisorTask;
      if (command.args.includes(BROWSERPOD_HEALTH_SOURCE)) return healthTask;
      throw new Error(`unexpected command ${command.executable}`);
    },
    async waitForPortal(port) {
      return { port, url: "https://browserpod.example/session", visibility: "public-url" };
    }
  };
  return { runtime, supervisorTask };
}

function installerFixture() {
  let calls = 0;
  const installed = Object.freeze({
    schemaVersion: 1,
    artifact: ARTIFACT,
    root: "/workspace/.clawsembly/openclaw",
    stateRoot: "/workspace/.clawsembly/openclaw/state",
    executablePath: "/workspace/.clawsembly/openclaw/node_modules/openclaw/openclaw.mjs",
    taskId: "install-task-1",
    durationMs: 10,
    outputTruncated: false,
    integrityMatched: true
  });
  return {
    artifact: ARTIFACT,
    root: installed.root,
    stateRoot: installed.stateRoot,
    executablePath: installed.executablePath,
    get calls() { return calls; },
    async install() { calls += 1; return installed; }
  };
}

test("starts once, exposes token only explicitly, and revokes it on stop", async () => {
  const { runtime, supervisorTask } = runtimeFixture();
  const installer = installerFixture();
  const output = [];
  const audit = [];
  let now = 1_000;
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer,
    tokenFactory: () => "gateway-private-token",
    supervisorNonceFactory: () => "supervisor_nonce_123456",
    onOutput: (event) => output.push(event),
    onAudit: (event) => audit.push(event),
    now: () => now += 10
  });
  const first = gateway.start();
  const concurrent = gateway.start();
  assert.equal(first, concurrent);
  const ready = await first;
  assert.equal(gateway.state, "ready");
  assert.equal(installer.calls, 1);
  assert.equal(ready.healthz.status, 200);
  assert.equal(ready.readyz.status, 200);
  assert.equal(gateway.task, supervisorTask);
  assert.deepEqual(gateway.connection(), {
    schemaVersion: 1,
    portal: { port: 18_789, url: "https://browserpod.example/session", visibility: "public-url" },
    auth: { mode: "token", token: "gateway-private-token" }
  });
  assert.equal(JSON.stringify(gateway).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(ready).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(audit).includes("gateway-private-token"), false);
  assert.deepEqual(new Set(output.map((event) => event.phase)), new Set(["gateway", "health"]));

  await assert.rejects(gateway.stop({ timeoutMs: 1 }), /stop timeout is invalid/u);
  assert.equal(gateway.state, "ready");
  assert.equal(gateway.connection().auth.token, "gateway-private-token");
  const stopped = await gateway.stop();
  assert.equal(stopped.complete, true);
  assert.equal(gateway.state, "stopped");
  assert.throws(() => gateway.connection(), (error) => error.code === "gateway_not_ready");
});

test("health failure cooperatively stops the child and clears connection authority", async () => {
  const { runtime, supervisorTask } = runtimeFixture({ healthStatus: "failed" });
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer: installerFixture(),
    tokenFactory: () => "gateway-private-token",
    supervisorNonceFactory: () => "supervisor_nonce_123456"
  });
  await assert.rejects(gateway.start(), (error) => error.code === "health_probe_failed");
  assert.equal(gateway.state, "failed");
  assert.equal(supervisorTask.status, "completed");
  assert.throws(() => gateway.connection(), (error) => error.code === "gateway_not_ready");
});

test("invalid token fails before installation", async () => {
  const { runtime } = runtimeFixture();
  const installer = installerFixture();
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer,
    tokenFactory: () => "short"
  });
  assert.throws(() => gateway.start(), /token of at least 16 characters/u);
  assert.equal(installer.calls, 0);
  assert.equal(gateway.state, "idle");
});

test("health parser rejects missing and oversized evidence", () => {
  assert.throws(() => parseBrowserPodHealthEvidence("ready"), (error) => error.code === "health_probe_failed");
  assert.throws(() => parseBrowserPodHealthEvidence(`${BROWSERPOD_HEALTH_PREFIX}${JSON.stringify({
    healthz: { status: 200, body: "x".repeat(4_097) },
    readyz: { status: 200, body: "ok" }
  })}`), (error) => error.code === "health_probe_failed");
});
