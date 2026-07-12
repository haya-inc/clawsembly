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

function helloFrame(id = "connect-1") {
  return {
    type: "res",
    id,
    ok: true,
    payload: {
      type: "hello-ok",
      protocol: 4,
      server: { version: "2026.6.11", connId: "connection-1" },
      features: { methods: ["chat.send", "chat.history", "chat.abort"], events: ["chat", "tick"] },
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

function fixture() {
  let socket;
  const audit = [];
  const client = createOpenClawGatewayClient({
    artifact: OPENCLAW_GATEWAY_CONTRACT.artifact,
    getConnection: () => connection,
    identity: identity(),
    browserOrigin: "https://embed.example",
    createWebSocket(url) { socket = new FakeWebSocket(url); return socket; },
    requestIdFactory: () => "connect-1",
    onAudit: (event) => audit.push(event),
    now: (() => { let value = 1_000; return () => value += 10; })()
  });
  return { client, audit, get socket() { return socket; } };
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
  assert.equal(JSON.stringify(hello).includes("issued-device-token"), false);
  assert.equal(JSON.stringify(current.audit).includes("gateway-private-token"), false);
  assert.equal(JSON.stringify(current.client).includes("gateway-private-token"), false);
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
