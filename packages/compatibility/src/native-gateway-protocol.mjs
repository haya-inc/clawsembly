// Native-Gateway protocol exercise (ADR 0006, decision 1.i): drive the
// generated embed-sdk Gateway client — unmodified — against the natively
// booted Gateway over loopback, and reduce the exchange to a bounded,
// payload-free protocol section for the native-gateway evidence record.
// Nothing from the wire is retained beyond statuses, enums, counts, and
// durations: no message text, no error text, no tokens, no host paths.

import { BrowserRuntimeError } from "../../browser-runtime/browser-runtime.mjs";
import { createOpenClawGatewayClient } from "../../embed-sdk/gateway-client.mjs";
import { createBrowserDeviceIdentity } from "../../embed-sdk/gateway-device-identity.mjs";
import { createGatewayDeviceTokenVault } from "../../embed-sdk/gateway-device-token-vault.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "../../embed-sdk/openclaw-gateway-contract.generated.mjs";
import { assertOpenClawGatewayPort, assertOpenClawGatewayToken } from "../../browser-runtime/openclaw-gateway.mjs";

export const NATIVE_PROTOCOL_SESSION_KEY = "native-evidence";
export const NATIVE_PROTOCOL_PROBE_MESSAGE = "Reply with the single word: pong";
const TERMINAL_CHAT_STATES = new Set(["final", "error", "aborted"]);

/** In-memory single-record store for the browser device identity. */
export function createMemoryDeviceIdentityStore() {
  let record;
  return Object.freeze({
    async read() { return record; },
    async add(value) {
      if (record !== undefined) return false;
      record = value;
      return true;
    }
  });
}

/** In-memory persistence for the encrypted Gateway device-token vault. */
export function createMemoryDeviceTokenPersistence() {
  const keys = new Map();
  const tokens = new Map();
  return Object.freeze({
    async readKey() { return keys.get("master"); },
    async addKey(key) {
      if (keys.has("master")) {
        const error = new Error("device-token master key already exists");
        error.name = "ConstraintError";
        throw error;
      }
      keys.set("master", key);
    },
    async readToken(id) { return tokens.get(id); },
    async writeToken(id, record) { tokens.set(id, record); },
    async deleteToken(id) { tokens.delete(id); }
  });
}

/**
 * WebSocket factory for the loopback native Gateway. The generated client
 * resolves the connection material to a wss:// URL; the native Gateway
 * serves plain WebSocket on loopback, so the factory rewrites the scheme
 * and presents the Gateway host's own origin — the stable Gateway admits
 * webchat connects only from origins in its Control-UI allowlist, and the
 * gateway host origin is the built-in member of that allowlist.
 */
export function createLoopbackControlUiWebSocketFactory({ port, webSocket = globalThis.WebSocket } = {}) {
  const gatewayPort = assertOpenClawGatewayPort(port);
  if (typeof webSocket !== "function") throw new TypeError("a WebSocket constructor is required");
  const WebSocketConstructor = webSocket;
  const origin = `http://127.0.0.1:${gatewayPort}`;
  return (url) => new WebSocketConstructor(url.replace(/^wss:/u, "ws:"), { headers: { origin } });
}

function protocolFailure(code, phase, error) {
  const reason = typeof error?.code === "string" ? error.code : "unexpected_error";
  return new BrowserRuntimeError(code, `the native Gateway protocol ${phase} failed (${reason})`);
}

function collectChatEvents(client) {
  const events = [];
  const waiters = new Set();
  const unsubscribe = client.chat.onEvent((event) => {
    events.push(event);
    for (const waiter of [...waiters]) waiter();
  });
  return {
    events,
    unsubscribe,
    waitFor(predicate, { timeoutMs, timeoutCode }) {
      return new Promise((resolve, reject) => {
        let timer;
        const check = () => {
          const match = events.find(predicate);
          if (match === undefined) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(match);
        };
        timer = setTimeout(() => {
          waiters.delete(check);
          reject(new BrowserRuntimeError(timeoutCode, "timed out waiting for a Gateway chat event"));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    }
  };
}

/**
 * Runs the full generated-client exercise against a ready loopback Gateway:
 * challenge-signed handshake, device-token issuance, bounded chat round
 * trip, abort, history, and a second connect that must authenticate with
 * the vaulted device token. Fails closed on any surface the lane promises:
 * a partial exercise never yields a protocol section.
 */
export async function exerciseNativeGatewayProtocol({
  artifact,
  port,
  token,
  createWebSocket,
  sessionKey = NATIVE_PROTOCOL_SESSION_KEY,
  waitBudgetMs = 60_000,
  now = Date.now
} = {}) {
  const expected = OPENCLAW_GATEWAY_CONTRACT.artifact;
  if (!artifact || artifact.package !== expected.package || artifact.version !== expected.version
    || artifact.integrity !== expected.integrity) {
    throw new BrowserRuntimeError(
      "contract_artifact_mismatch",
      "the pinned report artifact does not match the generated Gateway contract"
    );
  }
  const gatewayPort = assertOpenClawGatewayPort(port);
  assertOpenClawGatewayToken(token);
  if (typeof createWebSocket !== "function") throw new TypeError("a WebSocket factory is required");
  if (!Number.isSafeInteger(waitBudgetMs) || waitBudgetMs < 1_000 || waitBudgetMs > 600_000) {
    throw new TypeError("the protocol exercise wait budget is invalid");
  }
  if (typeof now !== "function") throw new TypeError("the protocol exercise clock is invalid");

  const origin = `http://127.0.0.1:${gatewayPort}`;
  const identity = createBrowserDeviceIdentity({ store: createMemoryDeviceIdentityStore() });
  const vault = createGatewayDeviceTokenVault({
    artifact,
    persistence: createMemoryDeviceTokenPersistence()
  });
  const connection = () => ({
    schemaVersion: 1,
    auth: { mode: "token", token },
    // The client's connection resolver models the HTTPS portal shape; the
    // socket factory maps the resolved wss URL back onto the plain loopback
    // listener. The evidence record names the real transport explicitly.
    portal: { visibility: "public-url", url: `https://127.0.0.1:${gatewayPort}` },
    allowedOrigins: [origin]
  });
  const openClient = () => createOpenClawGatewayClient({
    artifact,
    getConnection: connection,
    identity,
    deviceTokenVault: vault,
    browserOrigin: origin,
    createWebSocket,
    now
  });

  const client = openClient();
  let secondClient;
  try {
    const handshakeStartedAt = now();
    let hello;
    try { hello = await client.connect(); }
    catch (error) { throw protocolFailure("protocol_handshake_failed", "handshake", error); }
    const handshake = {
      durationMs: Math.max(0, now() - handshakeStartedAt),
      protocol: hello.protocol,
      methodCount: hello.features.methods.length,
      eventCount: hello.features.events.length,
      contractMethodsAdvertised: OPENCLAW_GATEWAY_CONTRACT.rpc.methods
        .every((method) => hello.features.methods.includes(method)),
      requiredScopesGranted: true,
      scopeCount: hello.auth.scopes.length,
      deviceTokenIssued: hello.auth.deviceTokenIssued,
      authenticatedWith: hello.auth.authenticatedWith
    };
    if (!handshake.contractMethodsAdvertised) {
      throw new BrowserRuntimeError(
        "protocol_methods_missing",
        "the Gateway did not advertise the generated contract's chat methods"
      );
    }
    if (handshake.deviceTokenIssued !== true || handshake.authenticatedWith !== "shared-token") {
      throw new BrowserRuntimeError(
        "protocol_device_token_missing",
        "the shared-token connect did not issue a Gateway device token"
      );
    }

    const collector = collectChatEvents(client);
    let chat;
    let abort;
    try {
      const chatStartedAt = now();
      let ack;
      try {
        ack = await client.chat.send({ sessionKey, message: NATIVE_PROTOCOL_PROBE_MESSAGE, timeoutMs: 30_000 });
      } catch (error) {
        throw protocolFailure("protocol_chat_failed", "chat.send round trip", error);
      }
      const terminal = await collector.waitFor(
        (event) => event.runId === ack.runId && TERMINAL_CHAT_STATES.has(event.state),
        { timeoutMs: waitBudgetMs, timeoutCode: "protocol_chat_timeout" }
      );
      chat = {
        sendStatus: ack.status,
        terminalState: terminal.state,
        eventCount: collector.events.filter((event) => event.runId === ack.runId).length,
        errorMessagePresent: terminal.errorMessage !== undefined,
        // The lane runs without any model-provider credential by design, so
        // a run reaching "error" at the provider boundary is the expected
        // full-protocol outcome, not a capture failure.
        providerCredential: false,
        durationMs: Math.max(0, now() - chatStartedAt)
      };

      const abortStartedAt = now();
      let abortAck;
      let abortResult;
      try {
        abortAck = await client.chat.send({ sessionKey, message: NATIVE_PROTOCOL_PROBE_MESSAGE, timeoutMs: 30_000 });
        abortResult = await client.chat.abort({ sessionKey, runId: abortAck.runId });
      } catch (error) {
        throw protocolFailure("protocol_abort_failed", "chat.abort round trip", error);
      }
      abort = {
        ok: abortResult.ok,
        aborted: abortResult.aborted,
        requestedRunIncluded: abortResult.runIds.includes(abortAck.runId),
        runIdCount: abortResult.runIds.length,
        durationMs: Math.max(0, now() - abortStartedAt)
      };
      // Let the aborted (or provider-failing) run settle before the Gateway
      // is stopped; the outcome is timing-dependent and never recorded.
      await collector.waitFor(
        (event) => event.runId === abortAck.runId && TERMINAL_CHAT_STATES.has(event.state),
        { timeoutMs: 15_000, timeoutCode: "protocol_chat_timeout" }
      ).catch(() => undefined);
    } finally {
      collector.unsubscribe();
    }

    const historyStartedAt = now();
    let historyResult;
    try { historyResult = await client.chat.history({ sessionKey, limit: 50 }); }
    catch (error) { throw protocolFailure("protocol_history_failed", "chat.history round trip", error); }
    const history = {
      messageCount: historyResult.messages.length,
      durationMs: Math.max(0, now() - historyStartedAt)
    };

    client.close();
    const reconnectStartedAt = now();
    secondClient = openClient();
    let reconnectHello;
    try { reconnectHello = await secondClient.connect(); }
    catch (error) { throw protocolFailure("protocol_reconnect_failed", "reconnect handshake", error); }
    const reconnect = {
      durationMs: Math.max(0, now() - reconnectStartedAt),
      authenticatedWith: reconnectHello.auth.authenticatedWith,
      deviceTokenIssued: reconnectHello.auth.deviceTokenIssued
    };
    if (reconnect.authenticatedWith !== "device-token") {
      throw new BrowserRuntimeError(
        "protocol_reconnect_not_device_token",
        "the reconnect did not authenticate with the vaulted device token"
      );
    }

    return Object.freeze({
      transport: "loopback-ws",
      originPolicy: "control-ui-host",
      handshake: Object.freeze(handshake),
      chat: Object.freeze(chat),
      abort: Object.freeze(abort),
      history: Object.freeze(history),
      reconnect: Object.freeze(reconnect)
    });
  } finally {
    client.close();
    secondClient?.close();
  }
}
