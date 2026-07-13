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

function runtimeFixture({ healthStatus = "completed", configStatus = "completed", pairingLists = [] } = {}) {
  const files = new Map();
  const commands = [];
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
  const configTask = {
    id: "config-task-1",
    status: configStatus,
    transcript: "Updated gateway.controlUi.allowedOrigins\n",
    outputTruncated: false,
    onOutput(listener) { listener(this.transcript); return () => true; },
    async wait() { return { status: configStatus, outputBytes: this.transcript.length, outputTruncated: false }; }
  };
  const deviceTask = (transcript) => ({
    id: `device-task-${commands.length + 1}`,
    status: "completed",
    transcript: `${JSON.stringify(transcript)}\n`,
    outputTruncated: false,
    onOutput() { return () => true; },
    async wait() { return { status: "completed", outputBytes: this.transcript.length, outputTruncated: false }; }
  });
  let pairingListIndex = 0;
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
      commands.push(command);
      if (command.args.includes("gateway.controlUi.allowedOrigins")) return configTask;
      if (command.args[0]?.endsWith("/supervisor-gateway.mjs")) return supervisorTask;
      if (command.args[0]?.endsWith("/clawsembly-health.mjs")) return healthTask;
      const devicesIndex = command.args.indexOf("devices");
      if (devicesIndex >= 0) {
        const action = command.args[devicesIndex + 1];
        if (action === "list") {
          const selected = pairingLists[Math.min(pairingListIndex, pairingLists.length - 1)] ?? { pending: [], paired: [] };
          pairingListIndex += 1;
          return deviceTask(selected);
        }
        const requestId = command.args[devicesIndex + 2];
        const selected = pairingLists[Math.max(0, Math.min(pairingListIndex - 1, pairingLists.length - 1))];
        const pending = selected?.pending?.find((entry) => entry.requestId === requestId);
        return deviceTask(action === "approve"
          ? { requestId, device: { deviceId: pending?.deviceId } }
          : { requestId, deviceId: pending?.deviceId });
      }
      throw new Error(`unexpected command ${command.executable}`);
    },
    async waitForPortal(port) {
      return { port, url: "https://browserpod.example/session", visibility: "public-url" };
    }
  };
  return { runtime, supervisorTask, commands };
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

test("starts once, pins browser origins, exposes token only explicitly, and revokes it on stop", async () => {
  const { runtime, supervisorTask, commands } = runtimeFixture();
  const installer = installerFixture();
  const output = [];
  const audit = [];
  let now = 1_000;
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer,
    allowedOrigins: ["https://embed.example"],
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
  assert.deepEqual(ready.allowedOrigins, ["https://embed.example"]);
  assert.equal(gateway.task, supervisorTask);
  assert.deepEqual(gateway.connection(), {
    schemaVersion: 1,
    portal: { port: 18_789, url: "https://browserpod.example/session", visibility: "public-url" },
    allowedOrigins: ["https://embed.example"],
    auth: { mode: "token", token: "gateway-private-token" }
  });
  assert.equal(JSON.stringify(gateway).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(ready).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(audit).includes("gateway-private-token"), false);
  assert.deepEqual(new Set(output.map((event) => event.phase)), new Set(["configure", "gateway", "health"]));
  const originCommand = commands.find((command) => command.args.includes("gateway.controlUi.allowedOrigins"));
  assert.deepEqual(originCommand.args.slice(-3), [
    "gateway.controlUi.allowedOrigins",
    '["https://embed.example"]',
    "--strict-json"
  ]);
  assert.equal(JSON.stringify(originCommand).includes("gateway-private-token"), false);

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

test("fails before Gateway launch when the exact origin policy cannot be configured", async () => {
  const { runtime, commands } = runtimeFixture({ configStatus: "failed" });
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer: installerFixture(),
    allowedOrigins: ["https://embed.example"],
    tokenFactory: () => "gateway-private-token"
  });
  await assert.rejects(gateway.start(), (error) => error.code === "origin_config_failed");
  assert.equal(commands.some((command) => command.args[0]?.endsWith("/supervisor-gateway.mjs")), false);
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

test("rejects wildcard, path-bearing, and insecure non-loopback browser origins", () => {
  const { runtime } = runtimeFixture();
  const create = (allowedOrigins) => createVerifiedOpenClawGateway({
    runtime,
    installer: installerFixture(),
    allowedOrigins
  });
  assert.throws(() => create(["*"]), /exact OpenClaw browser origin/u);
  assert.throws(() => create(["https://embed.example/path"]), /exact HTTPS or loopback/u);
  assert.throws(() => create(["http://embed.example"]), /exact HTTPS or loopback/u);
  assert.deepEqual(create(["http://127.0.0.1:5173"]).allowedOrigins, ["http://127.0.0.1:5173"]);
});

test("health parser rejects missing and oversized evidence", () => {
  assert.throws(() => parseBrowserPodHealthEvidence("ready"), (error) => error.code === "health_probe_failed");
  assert.throws(() => parseBrowserPodHealthEvidence(`${BROWSERPOD_HEALTH_PREFIX}${JSON.stringify({
    healthz: { status: 200, body: "x".repeat(4_097) },
    readyz: { status: 200, body: "ok" }
  })}`), (error) => error.code === "health_probe_failed");
});

test("reviews the exact pending operator request before one-shot approval", async () => {
  const deviceId = "a".repeat(64);
  const pending = {
    requestId: "pairing-request-1",
    deviceId,
    publicKey: "private-to-review-boundary",
    remoteIp: "private-ip",
    role: "operator",
    scopes: ["operator.write", "operator.read"],
    ts: 1
  };
  const { runtime, commands } = runtimeFixture({
    pairingLists: [{ pending: [pending], paired: [] }]
  });
  const audit = [];
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer: installerFixture(),
    tokenFactory: () => "gateway-private-token",
    supervisorNonceFactory: () => "supervisor_nonce_123456",
    pairingProfile: { role: "operator", scopes: ["operator.read", "operator.write"] },
    approvalIdFactory: () => "review-1",
    onAudit: (event) => audit.push(event)
  });
  await gateway.start();
  const review = await gateway.pairing.review({
    required: true,
    requestId: pending.requestId,
    deviceId,
    reason: "not-paired",
    role: "operator",
    scopes: ["operator.read", "operator.write"]
  });
  assert.deepEqual(review, {
    schemaVersion: 1,
    reviewId: "review-1",
    requestId: pending.requestId,
    deviceId,
    reason: "not-paired",
    requested: { roles: ["operator"], scopes: ["operator.read", "operator.write"] },
    approved: null,
    expiresAt: review.expiresAt
  });
  assert.equal(JSON.stringify(review).includes("private-to-review-boundary"), false);
  assert.equal(JSON.stringify(audit).includes("private-ip"), false);
  assert.deepEqual(await gateway.pairing.approve(review.reviewId), {
    schemaVersion: 1,
    decision: "approved",
    requestId: pending.requestId,
    deviceId
  });
  const deviceCommands = commands.filter((command) => command.args.includes("devices"));
  assert.deepEqual(deviceCommands.map((command) => command.args.slice(command.args.indexOf("devices"), -1)), [
    ["devices", "list"],
    ["devices", "list"],
    ["devices", "approve", "pairing-request-1"]
  ]);
  await assert.rejects(gateway.pairing.approve(review.reviewId), (error) => error.code === "pairing_review_stale");
});

test("refuses broader or changed pairing requests before approval", async () => {
  const deviceId = "b".repeat(64);
  const broad = {
    requestId: "pairing-request-broad",
    deviceId,
    role: "operator",
    scopes: ["operator.read", "operator.write", "operator.admin"]
  };
  const broadFixture = runtimeFixture({ pairingLists: [{ pending: [broad], paired: [] }] });
  const broadGateway = createVerifiedOpenClawGateway({
    runtime: broadFixture.runtime,
    installer: installerFixture(),
    tokenFactory: () => "gateway-private-token",
    supervisorNonceFactory: () => "supervisor_nonce_123456",
    pairingProfile: { role: "operator", scopes: ["operator.read", "operator.write"] },
    approvalIdFactory: () => "review-broad"
  });
  await broadGateway.start();
  await assert.rejects(broadGateway.pairing.review({
    required: true,
    requestId: broad.requestId,
    deviceId,
    reason: "scope-upgrade",
    role: "operator",
    scopes: ["operator.read", "operator.write"]
  }), (error) => error.code === "pairing_scope_mismatch");

  const original = { ...broad, requestId: "pairing-request-change", scopes: ["operator.read", "operator.write"] };
  const changed = { ...original, scopes: ["operator.read", "operator.write"], deviceId: "c".repeat(64) };
  const changedFixture = runtimeFixture({
    pairingLists: [
      { pending: [original], paired: [] },
      { pending: [changed], paired: [] }
    ]
  });
  const changedGateway = createVerifiedOpenClawGateway({
    runtime: changedFixture.runtime,
    installer: installerFixture(),
    tokenFactory: () => "gateway-private-token",
    supervisorNonceFactory: () => "supervisor_nonce_123456",
    pairingProfile: { role: "operator", scopes: ["operator.read", "operator.write"] },
    approvalIdFactory: () => "review-change"
  });
  await changedGateway.start();
  const review = await changedGateway.pairing.review({
    required: true,
    requestId: original.requestId,
    deviceId,
    reason: "not-paired",
    role: "operator",
    scopes: ["operator.read", "operator.write"]
  });
  await assert.rejects(changedGateway.pairing.approve(review.reviewId), (error) => error.code === "pairing_device_mismatch");
  assert.equal(changedFixture.commands.some((command) => command.args.includes("approve")), false);
});

test("stop during a failing start resolves as not running instead of rethrowing", async () => {
  const { runtime } = runtimeFixture({ configStatus: "failed" });
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer: installerFixture(),
    allowedOrigins: ["https://embed.example"],
    tokenFactory: () => "gateway-private-token"
  });
  const failing = gateway.start();
  const stopping = gateway.stop();
  await assert.rejects(failing, (error) => error.code === "origin_config_failed");
  const stopped = await stopping;
  assert.equal(stopped.complete, false);
  assert.match(stopped.reason, /not running/u);
  assert.equal(gateway.state, "failed");
});
