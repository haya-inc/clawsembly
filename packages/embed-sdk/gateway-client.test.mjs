import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenClawGatewayClient,
  OpenClawGatewayClientError,
  resolveGatewayWebSocketConnection
} from "./gateway-client.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
    this.closed = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value) { this.sent.push(value); }

  close(code, reason) {
    this.closed.push({ code, reason });
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
}

const connection = Object.freeze({
  schemaVersion: 1,
  portal: Object.freeze({
    port: 18_789,
    url: "https://pod.browserpod.example/session/",
    visibility: "public-url"
  }),
  allowedOrigins: Object.freeze(["https://embed.example"]),
  auth: Object.freeze({ mode: "token", token: "gateway-private-token" })
});

function identity() {
  const deviceId = "a".repeat(64);
  return {
    async descriptor() {
      return { deviceId, publicKey: "public-key", algorithm: "Ed25519", createdAt: "2026-07-12T00:00:00Z" };
    },
    async signConnect(params) {
      return {
        id: deviceId,
        publicKey: "public-key",
        signature: "signed-challenge",
        signedAt: 1_783_795_200_000,
        nonce: params.nonce
      };
    }
  };
}

function tokenVault(initial) {
  let record = initial;
  const calls = [];
  return {
    calls,
    async load(subject) {
      calls.push({ action: "load", subject });
      return record;
    },
    async store(value) {
      calls.push({ action: "store", value });
      record = { token: value.token, scopes: [...value.scopes], issuedAtMs: value.issuedAtMs };
      return {
        deviceId: value.deviceId,
        role: value.role,
        scopes: [...value.scopes],
        issuedAtMs: value.issuedAtMs,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        keyExtractable: false,
        algorithm: "AES-GCM-256"
      };
    },
    async metadata(subject) {
      calls.push({ action: "metadata", subject });
      return record ? {
        ...subject,
        scopes: [...record.scopes],
        issuedAtMs: record.issuedAtMs,
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
        keyExtractable: false,
        algorithm: "AES-GCM-256"
      } : undefined;
    },
    async clear(subject) {
      calls.push({ action: "clear", subject });
      const existed = Boolean(record);
      record = undefined;
      return existed;
    }
  };
}

function helloFrame(id = "connect-1", methods = ["chat.send", "chat.history", "chat.abort"]) {
  return {
    type: "res",
    id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 4,
      server: { version: "2026.6.11", connId: "connection-1" },
      features: { methods, events: ["chat", "tick"] },
      snapshot: { presence: [], health: {}, stateVersion: { presence: 1, health: 1 }, uptimeMs: 10 },
      auth: {
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        deviceToken: "issued-device-token"
      },
      policy: { maxPayload: 25 * 1024 * 1024, maxBufferedBytes: 50 * 1024 * 1024, tickIntervalMs: 15_000 }
    }
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function fixture(options = {}) {
  let socket;
  const audit = [];
  const gaps = [];
  let requestSequence = 0;
  const vault = options.deviceTokenVault ?? tokenVault();
  const client = createOpenClawGatewayClient({
    artifact: OPENCLAW_GATEWAY_CONTRACT.artifact,
    getConnection: () => connection,
    identity: identity(),
    deviceTokenVault: vault,
    browserOrigin: "https://embed.example",
    createWebSocket(url) { socket = new FakeWebSocket(url); return socket; },
    requestIdFactory: () => requestSequence++ === 0 ? "connect-1" : `request-${requestSequence}`,
    onAudit: (event) => audit.push(event),
    onGap: (gap) => { gaps.push(gap); options.onGap?.(gap); },
    now: (() => { let value = 1_000; return () => value += 10; })()
  });
  return { client, audit, gaps, vault, get socket() { return socket; } };
}

async function completeHandshake(current, methods) {
  const connecting = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "server-nonce", ts: 1 } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  const request = JSON.parse(current.socket.sent[0]);
  current.socket.emit("message", { data: JSON.stringify(helloFrame(request.id, methods)) });
  return connecting;
}

test("derives a WSS portal only for an explicitly allowed browser origin", () => {
  assert.deepEqual(resolveGatewayWebSocketConnection(connection, "https://embed.example"), {
    url: "wss://pod.browserpod.example/session/",
    origin: "https://embed.example",
    token: "gateway-private-token"
  });
  assert.throws(
    () => resolveGatewayWebSocketConnection(connection, "https://attacker.example"),
    (error) => error.code === "origin_not_allowed"
  );
  assert.throws(
    () => resolveGatewayWebSocketConnection({
      ...connection,
      portal: { ...connection.portal, url: "http://pod.browserpod.example" }
    }, "https://embed.example"),
    (error) => error.code === "invalid_portal"
  );
});

test("waits for challenge, signs protocol 4 connect, and redacts bearer tokens from results and audit", async () => {
  const current = fixture();
  const connecting = current.client.connect();
  assert.equal(current.socket.sent.length, 0);
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "server-nonce", ts: 1 } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  const connect = JSON.parse(current.socket.sent[0]);
  assert.deepEqual({
    type: connect.type,
    id: connect.id,
    method: connect.method,
    minProtocol: connect.params.minProtocol,
    maxProtocol: connect.params.maxProtocol,
    client: connect.params.client,
    role: connect.params.role,
    scopes: connect.params.scopes,
    auth: connect.params.auth,
    device: connect.params.device
  }, {
    type: "req",
    id: "connect-1",
    method: "connect",
    minProtocol: 4,
    maxProtocol: 4,
    client: {
      id: "webchat-ui",
      version: "clawsembly-embed-v1",
      platform: "browser",
      deviceFamily: "clawsembly",
      mode: "webchat"
    },
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    auth: { token: "gateway-private-token" },
    device: {
      id: "a".repeat(64),
      publicKey: "public-key",
      signature: "signed-challenge",
      signedAt: 1_783_795_200_000,
      nonce: "server-nonce"
    }
  });

  current.socket.emit("message", { data: JSON.stringify(helloFrame()) });
  const hello = await connecting;
  assert.equal(current.client.state, "ready");
  assert.equal(hello.protocol, 4);
  assert.equal(hello.auth.deviceTokenIssued, true);
  assert.equal(hello.auth.deviceTokenStored, true);
  assert.equal(hello.auth.authenticatedWith, "shared-token");
  assert.equal((await current.client.deviceAuth.metadata()).algorithm, "AES-GCM-256");
  assert.equal(JSON.stringify(hello).includes("issued-device-token"), false);
  assert.equal(JSON.stringify(current.audit).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(current.client).includes("gateway-private-token"), false);
});

test("sends only the generated chat RPC surface and delivers bounded stream events", async () => {
  const current = fixture();
  await completeHandshake(current);
  const events = [];
  current.client.chat.onEvent((event) => events.push(event));
  current.client.chat.onEvent(() => { throw new Error("listener failure"); });

  const sending = current.client.chat.send({
    sessionKey: "agent:main:clawsembly",
    message: "private user message",
    thinking: "low",
    timeoutMs: 20_000,
    runId: "run-1"
  });
  await waitFor(() => current.socket.sent.length === 2);
  const request = JSON.parse(current.socket.sent[1]);
  assert.deepEqual(request, {
    type: "req",
    id: "request-2",
    method: "chat.send",
    params: {
      sessionKey: "agent:main:clawsembly",
      message: "private user message",
      thinking: "low",
      deliver: false,
      timeoutMs: 20_000,
      idempotencyKey: "run-1"
    }
  });
  current.socket.emit("message", {
    data: JSON.stringify({ type: "res", id: request.id, ok: true, payload: { runId: "run-1", status: "started" } })
  });
  assert.deepEqual(await sending, { runId: "run-1", status: "started" });

  current.socket.emit("message", {
    data: JSON.stringify({
      type: "event",
      event: "chat",
      seq: 10,
      payload: {
        runId: "run-1",
        sessionKey: "agent:main:clawsembly",
        seq: 1,
        state: "delta",
        deltaText: "private assistant delta"
      }
    })
  });
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "event",
      event: "chat",
      seq: 12,
      payload: {
        runId: "run-1",
        sessionKey: "agent:main:clawsembly",
        seq: 2,
        state: "final",
        message: { role: "assistant", content: "private final" },
        stopReason: "stop"
      }
    })
  });
  assert.equal(events.length, 2);
  assert.equal(events[0].deltaText, "private assistant delta");
  assert.equal(events[1].state, "final");
  assert.deepEqual(current.gaps, [{ expected: 11, received: 12 }]);
  assert.equal(JSON.stringify(current.audit).includes("private user message"), false);
  assert.equal(JSON.stringify(current.audit).includes("private assistant delta"), false);
});

test("loads bounded history and confirms exact-run cancellation", async () => {
  const current = fixture();
  await completeHandshake(current);

  const historyPromise = current.client.chat.history({
    sessionKey: "agent:main:clawsembly",
    limit: 2,
    maxChars: 4_096
  });
  await waitFor(() => current.socket.sent.length === 2);
  const historyRequest = JSON.parse(current.socket.sent[1]);
  assert.equal(historyRequest.method, "chat.history");
  assert.deepEqual(historyRequest.params, {
    sessionKey: "agent:main:clawsembly",
    limit: 2,
    maxChars: 4_096
  });
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "res",
      id: historyRequest.id,
      ok: true,
      payload: { messages: [{ role: "user", content: "private history" }], sessionKey: "agent:main:clawsembly" }
    })
  });
  const history = await historyPromise;
  assert.equal(history.messages.length, 1);
  assert.equal(Object.isFrozen(history.messages), true);

  const abortPromise = current.client.chat.abort({
    sessionKey: "agent:main:clawsembly",
    runId: "run-1"
  });
  await waitFor(() => current.socket.sent.length === 3);
  const abortRequest = JSON.parse(current.socket.sent[2]);
  assert.equal(abortRequest.method, "chat.abort");
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "res",
      id: abortRequest.id,
      ok: true,
      payload: { ok: true, aborted: true, runIds: ["run-1"] }
    })
  });
  assert.deepEqual(await abortPromise, { ok: true, aborted: true, runIds: ["run-1"] });
  assert.equal(JSON.stringify(current.audit).includes("private history"), false);
});

test("rejects unadvertised methods and redacts Gateway RPC errors", async () => {
  const current = fixture();
  await completeHandshake(current, ["chat.send", "chat.history"]);
  await assert.rejects(
    current.client.chat.abort({ sessionKey: "global", runId: "run-1" }),
    (error) => error.code === "method_unavailable"
  );
  assert.equal(current.socket.sent.length, 1);

  const history = current.client.chat.history({ sessionKey: "global" });
  await waitFor(() => current.socket.sent.length === 2);
  const request = JSON.parse(current.socket.sent[1]);
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "res",
      id: request.id,
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message: "private-token private server detail",
        retryable: true,
        retryAfterMs: 500,
        details: { secret: "private-token" }
      }
    })
  });
  await assert.rejects(history, (error) => {
    assert.equal(error.code, "request_rejected");
    assert.equal(error.gatewayCode, "UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 500);
    assert.equal(JSON.stringify(error).includes("private-token"), false);
    return true;
  });
  assert.equal(JSON.stringify(current.audit).includes("private-token"), false);
});

test("rejects pending RPCs on disconnect and reconnects with a new signed handshake", async () => {
  const current = fixture();
  await completeHandshake(current);
  const pending = current.client.chat.history({ sessionKey: "global" });
  await waitFor(() => current.socket.sent.length === 2);
  const firstSocket = current.socket;
  firstSocket.emit("close", { code: 1006, reason: "private close reason" });
  await assert.rejects(pending, (error) => error.code === "connection_lost");
  assert.equal(current.client.state, "disconnected");
  assert.equal(JSON.stringify(current.audit).includes("private close reason"), false);

  const reconnecting = current.client.connect();
  assert.notEqual(current.socket, firstSocket);
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "reconnect-nonce" } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  const reconnectRequest = JSON.parse(current.socket.sent[0]);
  assert.deepEqual(reconnectRequest.params.auth, { deviceToken: "issued-device-token" });
  current.socket.emit("message", { data: JSON.stringify(helloFrame(reconnectRequest.id)) });
  const reconnected = await reconnecting;
  assert.equal(reconnected.protocol, 4);
  assert.equal(reconnected.auth.authenticatedWith, "device-token");
  assert.equal(current.client.state, "ready");
});

test("clears a rejected stored device token and falls back to shared auth on the next explicit connect", async () => {
  const current = fixture({
    deviceTokenVault: tokenVault({
      token: "stale-device-token",
      scopes: ["operator.read", "operator.write"],
      issuedAtMs: 1
    })
  });
  const first = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "first-nonce" } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  assert.deepEqual(JSON.parse(current.socket.sent[0]).params.auth, { deviceToken: "stale-device-token" });
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "res",
      id: "connect-1",
      ok: false,
      error: {
        code: "UNAUTHORIZED",
        message: "private stale token detail",
        details: { code: "AUTH_DEVICE_TOKEN_MISMATCH" }
      }
    })
  });
  await assert.rejects(first, (error) => error.code === "connect_rejected");
  assert.equal(current.vault.calls.some((call) => call.action === "clear"), true);

  const second = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "second-nonce" } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  const request = JSON.parse(current.socket.sent[0]);
  assert.deepEqual(request.params.auth, { token: "gateway-private-token" });
  current.socket.emit("message", { data: JSON.stringify(helloFrame(request.id)) });
  assert.equal((await second).auth.authenticatedWith, "shared-token");
  assert.equal(JSON.stringify(current.audit).includes("stale-device-token"), false);
});

test("cancels a pending local RPC without exposing or accepting a late response", async () => {
  const current = fixture();
  await completeHandshake(current);
  const controller = new AbortController();
  const history = current.client.chat.history(
    { sessionKey: "global" },
    { signal: controller.signal }
  );
  await waitFor(() => current.socket.sent.length === 2);
  const request = JSON.parse(current.socket.sent[1]);
  controller.abort();
  await assert.rejects(history, (error) => error.code === "aborted");
  current.socket.emit("message", {
    data: JSON.stringify({ type: "res", id: request.id, ok: true, payload: { messages: ["late private data"] } })
  });
  assert.equal(current.client.state, "ready");
  assert.equal(JSON.stringify(current.audit).includes("late private data"), false);
});

test("rejects chat fields outside the bounded generated surface", async () => {
  const current = fixture();
  await completeHandshake(current);
  await assert.rejects(
    current.client.chat.send({ sessionKey: "global", message: "hello", attachments: [] }),
    /chat\.send parameters are invalid/u
  );
  await assert.rejects(
    current.client.chat.send({ sessionKey: "global", message: " ", runId: "run-1" }),
    /chat message is invalid/u
  );
  await assert.rejects(
    current.client.chat.history({ sessionKey: "global", limit: 201 }),
    /history limit is invalid/u
  );
  assert.equal(current.socket.sent.length, 1);
});

test("surfaces bounded pairing metadata without echoing Gateway error details", async () => {
  const current = fixture();
  const connecting = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "pairing-nonce" } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "res",
      id: "connect-1",
      ok: false,
      error: {
        code: "NOT_PAIRED",
        message: "device pairing required; gateway-private-token",
        details: {
          code: "PAIRING_REQUIRED",
          requestId: "pairing-request-1",
          deviceId: "a".repeat(64),
          reason: "not-paired",
          unsafe: "gateway-private-token"
        }
      }
    })
  });
  await assert.rejects(connecting, (error) => {
    assert.ok(error instanceof OpenClawGatewayClientError);
    assert.equal(error.code, "pairing_required");
    assert.equal(error.gatewayCode, "NOT_PAIRED");
    assert.deepEqual(error.pairing, {
      required: true,
      requestId: "pairing-request-1",
      deviceId: "a".repeat(64),
      reason: "not-paired",
      role: "operator",
      scopes: ["operator.read", "operator.write"]
    });
    assert.equal(JSON.stringify(error).includes("gateway-private-token"), false);
    return true;
  });
  assert.equal(JSON.stringify(current.audit).includes("gateway-private-token"), false);
});

test("rejects unexpected and oversized pre-authentication frames", async () => {
  const unexpected = fixture();
  const first = unexpected.client.connect();
  unexpected.socket.emit("message", { data: JSON.stringify({ type: "event", event: "tick", payload: { ts: 1 } }) });
  await assert.rejects(first, (error) => error.code === "unexpected_frame");

  const oversized = fixture();
  const second = oversized.client.connect();
  oversized.socket.emit("message", { data: "x".repeat(65_537) });
  await assert.rejects(second, (error) => error.code === "frame_too_large");
});

test("clears an in-flight handshake when the owning session closes", async () => {
  const current = fixture();
  const connecting = current.client.connect();
  assert.equal(current.client.close(), true);
  await assert.rejects(connecting, (error) => error.code === "client_closed");
  assert.equal(current.client.state, "closed");
  assert.equal(current.socket.sent.length, 0);
  assert.equal(JSON.stringify(current.audit).includes("gateway-private-token"), false);
});

test("refuses a protocol client generated for a different artifact", () => {
  assert.throws(() => createOpenClawGatewayClient({
    artifact: { ...OPENCLAW_GATEWAY_CONTRACT.artifact, version: "2026.7.1" },
    getConnection: () => connection,
    identity: identity(),
    browserOrigin: "https://embed.example"
  }), /does not match the verified OpenClaw artifact/u);
});

test("ignores frames arriving after a failed handshake", async () => {
  const current = fixture();
  const connecting = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "server-nonce", ts: 1 } })
  });
  await waitFor(() => current.socket.sent.length === 1);
  const request = JSON.parse(current.socket.sent[0]);
  current.socket.emit("message", {
    data: JSON.stringify({ type: "res", id: request.id, ok: true, payload: { type: "hello-ok", protocol: 3 } })
  });
  await assert.rejects(connecting, (error) => error.code === "invalid_hello");
  assert.equal(current.client.state, "failed");

  const delivered = [];
  current.client.chat.onEvent((event) => delivered.push(event));
  current.socket.emit("message", {
    data: JSON.stringify({
      type: "event",
      event: OPENCLAW_GATEWAY_CONTRACT.rpc.event,
      seq: 1,
      payload: { runId: "run-1", sessionKey: "session", seq: 1, state: "delta", deltaText: "injected-after-failure" }
    })
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delivered.length, 0);
});

test("rejects a challenge nonce carrying signed-payload delimiters", async () => {
  const current = fixture();
  const connecting = current.client.connect();
  current.socket.emit("message", {
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "bad|nonce", ts: 1 } })
  });
  await assert.rejects(connecting, (error) => error.code === "invalid_challenge");
});

test("drops stale or rewound event sequences without delivery", async () => {
  const current = fixture();
  await completeHandshake(current);
  const delivered = [];
  current.client.chat.onEvent((event) => delivered.push(event.seq));
  const chatEvent = (seq) => ({
    type: "event",
    event: OPENCLAW_GATEWAY_CONTRACT.rpc.event,
    seq,
    payload: { runId: "run-1", sessionKey: "session", seq, state: "delta", deltaText: "x" }
  });
  current.socket.emit("message", { data: JSON.stringify(chatEvent(5)) });
  current.socket.emit("message", { data: JSON.stringify(chatEvent(5)) });
  current.socket.emit("message", { data: JSON.stringify(chatEvent(3)) });
  current.socket.emit("message", { data: JSON.stringify(chatEvent(6)) });
  await waitFor(() => delivered.length === 2);
  assert.deepEqual(delivered, [5, 6]);
  assert.equal(current.audit.filter((event) => event.reason === "stale_sequence").length, 2);
});
