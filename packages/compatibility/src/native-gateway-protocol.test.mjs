import assert from "node:assert/strict";
import test from "node:test";

import { OPENCLAW_GATEWAY_CONTRACT } from "../../embed-sdk/openclaw-gateway-contract.generated.mjs";
import {
  assertNativeGatewayEvidence,
  buildNativeGatewayEvidence,
  isValidNativeGatewayProtocolSection
} from "./native-gateway-capture.mjs";
import {
  NATIVE_PROTOCOL_SESSION_KEY,
  createLoopbackControlUiWebSocketFactory,
  createMemoryDeviceIdentityStore,
  createMemoryDeviceTokenPersistence,
  exerciseNativeGatewayProtocol
} from "./native-gateway-protocol.mjs";

const ARTIFACT = OPENCLAW_GATEWAY_CONTRACT.artifact;
const TOKEN = "native-protocol-test-token-0123456789";
const PORT = 18_789;

class ScriptedSocket {
  constructor(server) {
    this.server = server;
    this.listeners = new Map();
    this.closed = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }

  receive(payload) {
    queueMicrotask(() => this.emit("message", { data: JSON.stringify(payload) }));
  }

  send(data) { this.server.receive(this, data); }

  close(code, reason) { this.closed.push({ code, reason }); }
}

/**
 * Minimal scripted stand-in for the real Gateway's protocol-4 surface: one
 * challenge per socket, hello-ok with a scripted device token, a first chat
 * run that streams delta plus a terminal event, an abort that resolves the
 * second run, and a bounded history reply. The real-socket path is covered
 * by the CI capture against the actual artifact.
 */
class ScriptedGateway {
  constructor(options = {}) {
    this.options = {
      advertiseChatMethods: true,
      issueDeviceToken: true,
      emitTerminal: true,
      terminalState: "error",
      ...options
    };
    this.sockets = [];
    this.connectAuths = [];
    this.chatSends = 0;
    this.sequence = 0;
    this.issuedTokens = 0;
  }

  createWebSocketFactory() {
    return () => {
      const socket = new ScriptedSocket(this);
      this.sockets.push(socket);
      socket.receive({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: `server-nonce-${this.sockets.length}`, ts: this.sockets.length }
      });
      return socket;
    };
  }

  chatEvent(socket, payload) {
    socket.receive({ type: "event", event: "chat", payload });
  }

  receive(socket, data) {
    const frame = JSON.parse(data);
    if (frame.method === "connect") {
      this.connectAuths.push(frame.params.auth);
      const methods = this.options.advertiseChatMethods
        ? ["health", ...OPENCLAW_GATEWAY_CONTRACT.rpc.methods]
        : ["health"];
      const deviceToken = this.options.issueDeviceToken
        ? `issued-device-token-${++this.issuedTokens}`
        : undefined;
      socket.receive({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          type: "hello-ok",
          protocol: OPENCLAW_GATEWAY_CONTRACT.protocol.max,
          server: { version: ARTIFACT.version, connId: `conn-${this.sockets.length}` },
          features: { methods, events: ["chat", "health", "tick"] },
          snapshot: { uptimeMs: 12 },
          auth: {
            role: OPENCLAW_GATEWAY_CONTRACT.profile.role,
            scopes: [...OPENCLAW_GATEWAY_CONTRACT.profile.scopes],
            ...(deviceToken === undefined ? {} : { deviceToken, issuedAtMs: 1_784_000_000_000 })
          },
          policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 8 * 1024 * 1024, tickIntervalMs: 15_000 }
        }
      });
      return;
    }
    if (frame.method === "chat.send") {
      this.chatSends += 1;
      const runId = frame.params.idempotencyKey;
      const sessionKey = `agent:dev:${frame.params.sessionKey}`;
      socket.receive({ type: "res", id: frame.id, ok: true, payload: { runId, status: "started" } });
      if (this.chatSends === 1) {
        // A foreign-run event first: the exercise must count run-scoped
        // events only.
        this.chatEvent(socket, {
          runId: "unrelated-run", sessionKey, seq: ++this.sequence, state: "delta", deltaText: "x"
        });
        this.chatEvent(socket, {
          runId, sessionKey, seq: ++this.sequence, state: "delta", deltaText: "partial"
        });
        if (this.options.emitTerminal) {
          this.chatEvent(socket, {
            runId,
            sessionKey,
            seq: ++this.sequence,
            state: this.options.terminalState,
            ...(this.options.terminalState === "error"
              ? { errorMessage: "provider credential missing", errorKind: "unknown" }
              : {})
          });
        }
      } else {
        this.pendingAbortRun = { socket, runId, sessionKey };
      }
      return;
    }
    if (frame.method === "chat.abort") {
      const pending = this.pendingAbortRun;
      socket.receive({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { ok: true, aborted: Boolean(pending), runIds: pending ? [pending.runId] : [] }
      });
      if (pending) {
        this.chatEvent(pending.socket, {
          runId: pending.runId, sessionKey: pending.sessionKey, seq: ++this.sequence, state: "aborted"
        });
        this.pendingAbortRun = undefined;
      }
      return;
    }
    if (frame.method === "chat.history") {
      socket.receive({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { messages: [{ role: "user" }, { role: "assistant" }] }
      });
    }
  }
}

function exercise(gateway, overrides = {}) {
  return exerciseNativeGatewayProtocol({
    artifact: ARTIFACT,
    port: PORT,
    token: TOKEN,
    createWebSocket: gateway.createWebSocketFactory(),
    ...overrides
  });
}

test("exercises handshake, chat, abort, history, and device-token reconnect", async () => {
  const gateway = new ScriptedGateway();
  const protocol = await exercise(gateway);

  assert.equal(protocol.transport, "loopback-ws");
  assert.equal(protocol.originPolicy, "control-ui-host");
  assert.equal(protocol.handshake.protocol, OPENCLAW_GATEWAY_CONTRACT.protocol.max);
  assert.equal(protocol.handshake.methodCount, 4);
  assert.equal(protocol.handshake.contractMethodsAdvertised, true);
  assert.equal(protocol.handshake.deviceTokenIssued, true);
  assert.equal(protocol.handshake.authenticatedWith, "shared-token");
  assert.equal(protocol.chat.sendStatus, "started");
  assert.equal(protocol.chat.terminalState, "error");
  assert.equal(protocol.chat.eventCount, 2);
  assert.equal(protocol.chat.errorMessagePresent, true);
  assert.equal(protocol.chat.providerCredential, false);
  assert.equal(protocol.abort.ok, true);
  assert.equal(protocol.abort.aborted, true);
  assert.equal(protocol.abort.requestedRunIncluded, true);
  assert.equal(protocol.abort.runIdCount, 1);
  assert.equal(protocol.history.messageCount, 2);
  assert.equal(protocol.reconnect.authenticatedWith, "device-token");
  assert.equal(protocol.reconnect.deviceTokenIssued, true);
  assert.ok(isValidNativeGatewayProtocolSection(protocol));

  // Two sockets: first connect authenticated with the shared token, the
  // reconnect with the first issued device token from the encrypted vault.
  assert.equal(gateway.sockets.length, 2);
  assert.deepEqual(gateway.connectAuths[0], { token: TOKEN });
  assert.deepEqual(gateway.connectAuths[1], { deviceToken: "issued-device-token-1" });
});

test("fails closed when the Gateway withholds contract methods or device tokens", async () => {
  await assert.rejects(
    exercise(new ScriptedGateway({ advertiseChatMethods: false })),
    (error) => error.code === "protocol_methods_missing"
  );
  await assert.rejects(
    exercise(new ScriptedGateway({ issueDeviceToken: false })),
    (error) => error.code === "protocol_device_token_missing"
  );
});

test("fails closed when no terminal chat event arrives inside the wait budget", async () => {
  await assert.rejects(
    exercise(new ScriptedGateway({ emitTerminal: false }), { waitBudgetMs: 1_000 }),
    (error) => error.code === "protocol_chat_timeout"
  );
});

test("rejects a report artifact that drifts from the generated contract", async () => {
  const gateway = new ScriptedGateway();
  await assert.rejects(
    exercise(gateway, { artifact: { ...ARTIFACT, version: "2026.9.9" } }),
    (error) => error.code === "contract_artifact_mismatch"
  );
  assert.equal(gateway.sockets.length, 0);
});

test("memory identity store and token persistence hold exactly one subject", async () => {
  const store = createMemoryDeviceIdentityStore();
  assert.equal(await store.read(), undefined);
  assert.equal(await store.add({ version: 1 }), true);
  assert.equal(await store.add({ version: 1 }), false);
  assert.deepEqual(await store.read(), { version: 1 });

  const persistence = createMemoryDeviceTokenPersistence();
  assert.equal(await persistence.readKey(), undefined);
  await persistence.addKey("master-key");
  await assert.rejects(persistence.addKey("another"), (error) => error.name === "ConstraintError");
  await persistence.writeToken("token-1", { record: true });
  assert.deepEqual(await persistence.readToken("token-1"), { record: true });
  await persistence.deleteToken("token-1");
  assert.equal(await persistence.readToken("token-1"), undefined);
});

test("the loopback factory presents the gateway-host origin header", () => {
  const calls = [];
  function recordingSocket(url, options) { calls.push({ url, options }); }
  const factory = createLoopbackControlUiWebSocketFactory({ port: PORT, webSocket: recordingSocket });
  factory(`ws://127.0.0.1:${PORT}/`);
  assert.deepEqual(calls, [{
    url: `ws://127.0.0.1:${PORT}/`,
    options: { headers: { origin: `http://127.0.0.1:${PORT}` } }
  }]);
});

test("evidence v2 admits only records carrying the full protocol section", async () => {
  const protocol = await exercise(new ScriptedGateway());
  const evidence = buildNativeGatewayEvidence({
    artifact: ARTIFACT,
    nodeEngine: ">=24.15.0 <25",
    install: { integrityMatched: true, durationMs: 1_234, outputTruncated: false },
    gateway: { port: PORT, readyDurationMs: 10 },
    health: { healthz: { status: 200 }, readyz: { status: 200 } },
    termination: { mode: "signal", graceful: true },
    protocol,
    capturedAt: "2026-07-22T00:00:00.000Z"
  });
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(assertNativeGatewayEvidence(evidence, { artifact: ARTIFACT }), evidence);

  assert.throws(
    () => buildNativeGatewayEvidence({
      artifact: ARTIFACT,
      nodeEngine: ">=24.15.0 <25",
      install: { integrityMatched: true, durationMs: 1_234, outputTruncated: false },
      gateway: { port: PORT, readyDurationMs: 10 },
      health: { healthz: { status: 200 }, readyz: { status: 200 } },
      termination: { mode: "signal", graceful: true },
      capturedAt: "2026-07-22T00:00:00.000Z"
    }),
    (error) => error instanceof TypeError
  );
  assert.throws(
    () => buildNativeGatewayEvidence({
      artifact: ARTIFACT,
      nodeEngine: ">=24.15.0 <25",
      install: { integrityMatched: true, durationMs: 1_234, outputTruncated: false },
      gateway: { port: PORT, readyDurationMs: 10 },
      health: { healthz: { status: 200 }, readyz: { status: 200 } },
      termination: { mode: "signal", graceful: true },
      protocol: { ...protocol, chat: { ...protocol.chat, terminalState: "transcript text" } },
      capturedAt: "2026-07-22T00:00:00.000Z"
    }),
    (error) => error instanceof TypeError
  );

  const withoutProtocol = { ...evidence };
  delete withoutProtocol.protocol;
  assert.throws(
    () => assertNativeGatewayEvidence(withoutProtocol),
    (error) => error.code === "invalid_native_evidence"
  );
  assert.throws(
    () => assertNativeGatewayEvidence({
      ...evidence,
      protocol: { ...evidence.protocol, reconnect: { ...evidence.protocol.reconnect, authenticatedWith: "shared-token" } }
    }),
    (error) => error.code === "invalid_native_evidence"
  );
  assert.throws(
    () => assertNativeGatewayEvidence({ ...evidence, schemaVersion: 1 }),
    (error) => error.code === "invalid_native_evidence"
  );
});

test("the default session key stays a bounded identifier", () => {
  assert.match(NATIVE_PROTOCOL_SESSION_KEY, /^[a-z][a-z0-9-]{0,63}$/u);
});
