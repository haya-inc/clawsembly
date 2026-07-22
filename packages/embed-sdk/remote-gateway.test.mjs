import assert from "node:assert/strict";
import test from "node:test";

import { resolveGatewayWebSocketConnection } from "./gateway-client.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";
import { connectRemoteOpenClawGateway, createRemoteGatewayConnection } from "./remote-gateway.mjs";

const TOKEN = "remote-gateway-shared-token";
const EMBED_ORIGIN = "https://cockpit.example";

function material(overrides = {}) {
  return createRemoteGatewayConnection({
    url: "https://gateway.example:18789",
    token: TOKEN,
    allowedOrigins: [EMBED_ORIGIN],
    ...overrides
  });
}

test("normalizes HTTP(S) endpoints onto WebSocket schemes and strips fragments", () => {
  assert.equal(material().gateway.url, "wss://gateway.example:18789/");
  assert.equal(material().gateway.loopback, false);
  assert.equal(material({ url: "wss://gateway.example/ws#frag" }).gateway.url, "wss://gateway.example/ws");
  assert.equal(material({ url: "http://127.0.0.1:18789" }).gateway.url, "ws://127.0.0.1:18789/");
  assert.equal(material({ url: "http://127.0.0.1:18789" }).gateway.loopback, true);
  assert.equal(material({ url: "ws://localhost:18789" }).gateway.url, "ws://localhost:18789/");
});

test("fails closed on cleartext remote hosts, credentials, and invalid input", () => {
  assert.throws(() => material({ url: "http://gateway.example:18789" }), /loopback/u);
  assert.throws(() => material({ url: "ws://gateway.example:18789" }), /loopback/u);
  assert.throws(() => material({ url: "ftp://gateway.example" }), /HTTP\(S\) or WebSocket/u);
  assert.throws(() => material({ url: "https://user:pw@gateway.example" }), /credentials/u);
  assert.throws(() => material({ url: "not a url" }), /invalid/u);
  assert.throws(() => material({ token: "short" }), /token/u);
  assert.throws(() => material({ token: `${TOKEN}\n` }), /token/u);
  assert.throws(() => material({ allowedOrigins: [] }), /allowed origins/u);
  assert.throws(() => material({ allowedOrigins: ["https://cockpit.example/path"] }), /exact origins/u);
});

test("the client resolver accepts remote material and keeps the origin allowlist", () => {
  const resolved = resolveGatewayWebSocketConnection(material(), EMBED_ORIGIN);
  assert.deepEqual(resolved, {
    url: "wss://gateway.example:18789/",
    origin: EMBED_ORIGIN,
    token: TOKEN
  });
  assert.throws(
    () => resolveGatewayWebSocketConnection(material(), "https://attacker.example"),
    (error) => error.code === "origin_not_allowed"
  );
  assert.throws(
    () => resolveGatewayWebSocketConnection({ ...material(), portal: { visibility: "public-url", url: "https://x.example" } }, EMBED_ORIGIN),
    (error) => error.code === "invalid_connection"
  );
  assert.throws(
    () => resolveGatewayWebSocketConnection({ ...material(), gateway: { url: "ws://gateway.example/" } }, EMBED_ORIGIN),
    (error) => error.code === "invalid_gateway_endpoint"
  );
});

function fixtureIdentity() {
  const deviceId = "b".repeat(64);
  return {
    async descriptor() {
      return { deviceId, publicKey: "public-key", algorithm: "Ed25519", createdAt: "2026-07-22T00:00:00Z" };
    },
    async signConnect(params) {
      return {
        id: deviceId,
        publicKey: "public-key",
        signature: "signed-challenge",
        signedAt: 1_784_000_000_000,
        nonce: params.nonce
      };
    }
  };
}

function fixtureVault() {
  let record;
  return {
    async load() { return record; },
    async store(value) { record = { token: value.token, scopes: [...value.scopes] }; },
    async metadata() { return undefined; },
    async clear() { record = undefined; return false; }
  };
}

class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.sent = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(value) { this.sent.push(value); }

  close() {}

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }
}

function helloPayload(serverVersion = OPENCLAW_GATEWAY_CONTRACT.artifact.version) {
  return {
    type: "hello-ok",
    protocol: 4,
    server: { version: serverVersion, connId: "remote-conn-1" },
    features: { methods: [...OPENCLAW_GATEWAY_CONTRACT.rpc.methods], events: ["chat"] },
    snapshot: { uptimeMs: 5 },
    auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
    policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 4 * 1024 * 1024, tickIntervalMs: 15_000 }
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("condition was not reached");
}

function remoteClient({ serverVersion } = {}) {
  let socket;
  const client = connectRemoteOpenClawGateway({
    connection: material({ url: "http://127.0.0.1:18789" }),
    browserOrigin: EMBED_ORIGIN,
    identity: fixtureIdentity(),
    deviceTokenVault: fixtureVault(),
    createWebSocket(url) { socket = new FakeWebSocket(url); return socket; }
  });
  const connecting = client.connect();
  connecting.catch(() => undefined);
  const drive = (async () => {
    await waitFor(() => socket !== undefined);
    socket.emit("message", {
      data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "remote-nonce", ts: 1 } })
    });
    await waitFor(() => socket.sent.length === 1);
    const request = JSON.parse(socket.sent[0]);
    socket.emit("message", {
      data: JSON.stringify({ type: "res", id: request.id, ok: true, payload: helloPayload(serverVersion) })
    });
    return request;
  })();
  return { client, connecting, drive, get socket() { return socket; } };
}

test("connects the generated client against a loopback remote Gateway", async () => {
  const current = remoteClient();
  const request = await current.drive;
  assert.equal(current.socket.url, "ws://127.0.0.1:18789/");
  assert.equal(request.method, "connect");
  assert.deepEqual(request.params.auth, { token: TOKEN });
  const hello = await current.connecting;
  assert.equal(hello.protocol, 4);
  assert.equal(hello.auth.authenticatedWith, "shared-token");
  assert.equal(current.client.state, "ready");
  current.client.close();
});

test("a Gateway on another OpenClaw version fails closed with server_version_mismatch", async () => {
  const current = remoteClient({ serverVersion: "2099.1.1" });
  await current.drive;
  await assert.rejects(current.connecting, (error) => error.code === "server_version_mismatch");
  current.client.close();
});

test("rejects ambiguous or non-remote connection input", () => {
  assert.throws(() => connectRemoteOpenClawGateway({ browserOrigin: EMBED_ORIGIN }), /exactly one/u);
  assert.throws(
    () => connectRemoteOpenClawGateway({
      connection: material(),
      getConnection: () => material(),
      browserOrigin: EMBED_ORIGIN
    }),
    /exactly one/u
  );
  assert.throws(
    () => connectRemoteOpenClawGateway({
      connection: {
        schemaVersion: 1,
        portal: { visibility: "public-url", url: "https://pod.example/session/" },
        allowedOrigins: [EMBED_ORIGIN],
        auth: { mode: "token", token: TOKEN }
      },
      browserOrigin: EMBED_ORIGIN,
      identity: fixtureIdentity(),
      deviceTokenVault: fixtureVault()
    }),
    /remote Gateway connection material/u
  );
});
