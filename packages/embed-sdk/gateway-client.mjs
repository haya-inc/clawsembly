import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";
import { createGatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";

const NON_EMPTY = /\S/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const GATEWAY_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;
const CHAT_STATES = new Set(["delta", "final", "aborted", "error"]);

export class OpenClawGatewayClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "OpenClawGatewayClientError";
    this.code = code;
    if (options.gatewayCode) this.gatewayCode = options.gatewayCode;
    if (options.pairing) this.pairing = options.pairing;
    if (options.retryable === true) this.retryable = true;
    if (Number.isSafeInteger(options.retryAfterMs)) this.retryAfterMs = options.retryAfterMs;
  }
}

function fail(code, message, options) {
  return new OpenClawGatewayClientError(code, message, options);
}

function safeSink(sink, value) {
  try { sink?.(Object.freeze(value)); }
  catch { /* Diagnostics cannot break protocol control flow. */ }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value, max = 4_096) {
  return typeof value === "string" && value.length <= max && NON_EMPTY.test(value);
}

function stringArray(value, maxItems = 4_096) {
  return Array.isArray(value) && value.length <= maxItems
    && value.every((entry) => isNonEmptyString(entry, 512));
}

function exactOrigin(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function assertObject(value, label, allowedKeys) {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new TypeError(`${label} parameters are invalid`);
  }
  return value;
}

function assertSessionKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 256 || /[\0\r\n]/u.test(value)) {
    throw new TypeError("chat session key is invalid");
  }
  return value;
}

function assertAgentId(value) {
  if (value !== undefined && (typeof value !== "string" || !AGENT_ID.test(value))) {
    throw new TypeError("chat agent id is invalid");
  }
  return value;
}

function assertRunId(value, label = "chat run id") {
  if (typeof value !== "string" || !SAFE_REQUEST_ID.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}

function sanitizeChatEvent(payload) {
  if (!isRecord(payload) || !isNonEmptyString(payload.runId, 128)
    || !SAFE_REQUEST_ID.test(payload.runId) || !isNonEmptyString(payload.sessionKey, 256)
    || /[\0\r\n]/u.test(payload.sessionKey) || !Number.isSafeInteger(payload.seq)
    || payload.seq < 0 || !CHAT_STATES.has(payload.state)
    || (payload.state === "delta" && typeof payload.deltaText !== "string")
    || (payload.replace !== undefined && typeof payload.replace !== "boolean")) {
    throw fail("invalid_chat_event", "Gateway returned an invalid chat event");
  }
  for (const key of ["agentId", "spawnedBy", "stopReason", "errorMessage"]) {
    if (payload[key] !== undefined && !isNonEmptyString(payload[key], key === "errorMessage" ? 65_536 : 512)) {
      throw fail("invalid_chat_event", "Gateway returned an invalid chat event");
    }
  }
  if (payload.errorKind !== undefined && !["refusal", "timeout", "rate_limit", "context_length", "unknown"].includes(payload.errorKind)) {
    throw fail("invalid_chat_event", "Gateway returned an invalid chat event");
  }
  return Object.freeze({
    runId: payload.runId,
    sessionKey: payload.sessionKey,
    ...(payload.agentId === undefined ? {} : { agentId: payload.agentId }),
    ...(payload.spawnedBy === undefined ? {} : { spawnedBy: payload.spawnedBy }),
    seq: payload.seq,
    state: payload.state,
    ...(payload.deltaText === undefined ? {} : { deltaText: payload.deltaText }),
    ...(payload.replace === undefined ? {} : { replace: payload.replace === true }),
    ...(payload.message === undefined ? {} : { message: payload.message }),
    ...(payload.usage === undefined ? {} : { usage: payload.usage }),
    ...(payload.stopReason === undefined ? {} : { stopReason: payload.stopReason }),
    ...(payload.errorMessage === undefined ? {} : { errorMessage: payload.errorMessage }),
    ...(payload.errorKind === undefined ? {} : { errorKind: payload.errorKind })
  });
}

function assertArtifact(artifact) {
  const expected = OPENCLAW_GATEWAY_CONTRACT.artifact;
  if (!artifact || artifact.package !== expected.package || artifact.version !== expected.version
    || artifact.integrity !== expected.integrity) {
    throw new TypeError("Gateway client contract does not match the verified OpenClaw artifact");
  }
  return artifact;
}

function assertIdentity(identity) {
  if (!identity || typeof identity.descriptor !== "function" || typeof identity.signConnect !== "function") {
    throw new TypeError("a persistent browser device identity is required");
  }
  return identity;
}

function assertDeviceTokenVault(vault) {
  if (!vault || typeof vault.load !== "function" || typeof vault.store !== "function"
    || typeof vault.metadata !== "function" || typeof vault.clear !== "function") {
    throw new TypeError("a Gateway device-token vault is required");
  }
  return vault;
}

function assertStoredDeviceToken(value) {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isNonEmptyString(value.token, 2_048) || /[|\0\r\n]/u.test(value.token)
    || !stringArray(value.scopes, 64)
    || (value.issuedAtMs !== undefined && (!Number.isSafeInteger(value.issuedAtMs) || value.issuedAtMs < 0))) {
    throw new Error("stored Gateway device token is invalid");
  }
  return value;
}

export function resolveGatewayWebSocketConnection(connection, browserOrigin) {
  if (!connection || connection.schemaVersion !== 1 || connection.auth?.mode !== "token"
    || !isNonEmptyString(connection.auth.token, 512) || connection.auth.token.length < 16
    || /[|\0\r\n]/u.test(connection.auth.token)
    || connection.portal?.visibility !== "public-url" || !isNonEmptyString(connection.portal.url, 2_048)) {
    throw fail("invalid_connection", "verified Gateway connection material is invalid");
  }
  const origin = exactOrigin(browserOrigin);
  if (!origin || !Array.isArray(connection.allowedOrigins) || !connection.allowedOrigins.includes(origin)) {
    throw fail("origin_not_allowed", "browser origin is not in the Gateway allowlist");
  }
  let portal;
  try { portal = new URL(connection.portal.url); }
  catch { throw fail("invalid_portal", "BrowserPod portal URL is invalid"); }
  if (portal.protocol !== "https:" || portal.username || portal.password) {
    throw fail("invalid_portal", "BrowserPod Gateway portal must use authenticated HTTPS");
  }
  portal.protocol = "wss:";
  portal.hash = "";
  return Object.freeze({ url: portal.href, origin, token: connection.auth.token });
}

function pairingFrom(error, signedDeviceId) {
  const details = isRecord(error?.details) ? error.details : {};
  const detailCode = typeof details.code === "string" ? details.code : "";
  const pairingRequired = error?.code === "NOT_PAIRED" || detailCode === "PAIRING_REQUIRED";
  if (!pairingRequired) return undefined;
  const requestId = SAFE_REQUEST_ID.test(details.requestId ?? "") ? details.requestId : undefined;
  const deviceId = DEVICE_ID.test(details.deviceId ?? "") ? details.deviceId : signedDeviceId;
  const reason = ["not-paired", "role-upgrade", "scope-upgrade", "metadata-upgrade"].includes(details.reason)
    ? details.reason
    : "not-paired";
  return Object.freeze({
    required: true,
    ...(requestId ? { requestId } : {}),
    ...(deviceId && DEVICE_ID.test(deviceId) ? { deviceId } : {}),
    reason,
    role: OPENCLAW_GATEWAY_CONTRACT.profile.role,
    scopes: OPENCLAW_GATEWAY_CONTRACT.profile.scopes
  });
}

function parseHello(payload, artifactVersion) {
  if (!isRecord(payload) || payload.type !== "hello-ok"
    || payload.protocol !== OPENCLAW_GATEWAY_CONTRACT.protocol.max
    || !isRecord(payload.server) || payload.server.version !== artifactVersion
    || !isNonEmptyString(payload.server.connId, 256)
    || !isRecord(payload.features) || !stringArray(payload.features.methods)
    || !stringArray(payload.features.events) || !isRecord(payload.snapshot)
    || !isRecord(payload.auth) || payload.auth.role !== OPENCLAW_GATEWAY_CONTRACT.profile.role
    || !stringArray(payload.auth.scopes, 64)
    || !isRecord(payload.policy) || !Number.isSafeInteger(payload.policy.maxPayload)
    || payload.policy.maxPayload < 1 || !Number.isSafeInteger(payload.policy.maxBufferedBytes)
    || payload.policy.maxBufferedBytes < 1 || !Number.isSafeInteger(payload.policy.tickIntervalMs)
    || payload.policy.tickIntervalMs < 1) {
    throw fail("invalid_hello", "Gateway returned an invalid hello-ok contract");
  }
  const requiredScopes = OPENCLAW_GATEWAY_CONTRACT.profile.scopes;
  if (!requiredScopes.every((scope) => payload.auth.scopes.includes(scope))) {
    throw fail("scope_mismatch", "Gateway did not grant the requested operator scopes");
  }
  const deviceToken = payload.auth.deviceToken;
  if (deviceToken !== undefined && (!isNonEmptyString(deviceToken, 2_048) || /[|\0\r\n]/u.test(deviceToken))) {
    throw fail("invalid_hello", "Gateway returned an invalid hello-ok device token");
  }
  if (payload.auth.issuedAtMs !== undefined
    && (!Number.isSafeInteger(payload.auth.issuedAtMs) || payload.auth.issuedAtMs < 0)) {
    throw fail("invalid_hello", "Gateway returned an invalid hello-ok issue time");
  }
  const hello = Object.freeze({
    schemaVersion: 1,
    protocol: payload.protocol,
    server: Object.freeze({ version: payload.server.version, connId: payload.server.connId }),
    features: Object.freeze({
      methods: Object.freeze([...payload.features.methods]),
      events: Object.freeze([...payload.features.events])
    }),
    auth: Object.freeze({
      role: payload.auth.role,
      scopes: Object.freeze([...payload.auth.scopes]),
      deviceTokenIssued: deviceToken !== undefined
    }),
    policy: Object.freeze({
      maxPayload: payload.policy.maxPayload,
      maxBufferedBytes: payload.policy.maxBufferedBytes,
      tickIntervalMs: payload.policy.tickIntervalMs
    })
  });
  return Object.freeze({
    hello,
    ...(deviceToken === undefined ? {} : { deviceToken }),
    ...(payload.auth.issuedAtMs === undefined ? {} : { issuedAtMs: payload.auth.issuedAtMs })
  });
}

export function createOpenClawGatewayClient({
  artifact,
  getConnection,
  identity,
  deviceTokenVault,
  browserOrigin = globalThis.location?.origin,
  createWebSocket = (url) => new WebSocket(url),
  requestIdFactory = () => globalThis.crypto.randomUUID(),
  timeoutMs = OPENCLAW_GATEWAY_CONTRACT.limits.handshakeTimeoutMs,
  onAudit,
  onGap,
  now = Date.now
}) {
  const verifiedArtifact = assertArtifact(artifact);
  if (typeof getConnection !== "function") throw new TypeError("Gateway connection supplier is required");
  const verifiedIdentity = assertIdentity(identity);
  const verifiedDeviceTokenVault = assertDeviceTokenVault(
    deviceTokenVault ?? createGatewayDeviceTokenVault({ artifact: verifiedArtifact })
  );
  const origin = exactOrigin(browserOrigin);
  if (!origin) throw new TypeError("an exact browser origin is required");
  if (typeof createWebSocket !== "function") throw new TypeError("WebSocket factory is invalid");
  if (typeof requestIdFactory !== "function") throw new TypeError("request id factory is invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("Gateway handshake timeout is invalid");
  }
  if (onAudit !== undefined && typeof onAudit !== "function") throw new TypeError("Gateway client audit sink is invalid");
  if (onGap !== undefined && typeof onGap !== "function") throw new TypeError("Gateway gap sink is invalid");
  if (typeof now !== "function") throw new TypeError("Gateway client clock is invalid");

  let state = "idle";
  let socket;
  let inFlight;
  let hello;
  let cancelHandshake;
  let lastSequence = null;
  const pendingRequests = new Map();
  const chatListeners = new Set();

  function nextRequestId(label) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const value = requestIdFactory();
      if (typeof value === "string" && SAFE_REQUEST_ID.test(value) && !pendingRequests.has(value)) return value;
    }
    throw new TypeError(`${label} is invalid or duplicated`);
  }

  function flushPending(error) {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      safeSink(onAudit, {
        action: "gateway-rpc",
        outcome: "failed",
        method: pending.method,
        reason: error.code,
        durationMs: Math.max(0, now() - pending.startedAt)
      });
      pending.reject(error);
    }
    pendingRequests.clear();
  }

  function handleAuthenticatedFrame(frame) {
    if (!isRecord(frame) || typeof frame.type !== "string") {
      safeSink(onAudit, { action: "gateway-frame", outcome: "rejected", reason: "invalid_frame" });
      return;
    }
    if (frame.type === "res") {
      if (typeof frame.id !== "string" || typeof frame.ok !== "boolean") return;
      const pending = pendingRequests.get(frame.id);
      if (!pending) return;
      pendingRequests.delete(frame.id);
      clearTimeout(pending.timer);
      pending.signal?.removeEventListener("abort", pending.abort);
      const durationMs = Math.max(0, now() - pending.startedAt);
      if (frame.ok) {
        safeSink(onAudit, { action: "gateway-rpc", outcome: "succeeded", method: pending.method, durationMs });
        pending.resolve(frame.payload);
        return;
      }
      const gatewayCode = typeof frame.error?.code === "string" && GATEWAY_CODE.test(frame.error.code)
        ? frame.error.code
        : undefined;
      const error = fail("request_rejected", "Gateway rejected the RPC request", {
        gatewayCode,
        retryable: frame.error?.retryable === true,
        retryAfterMs: Number.isSafeInteger(frame.error?.retryAfterMs) && frame.error.retryAfterMs >= 0
          && frame.error.retryAfterMs <= 300_000
          ? frame.error.retryAfterMs
          : undefined
      });
      safeSink(onAudit, {
        action: "gateway-rpc",
        outcome: "failed",
        method: pending.method,
        reason: gatewayCode ?? error.code,
        durationMs
      });
      pending.reject(error);
      return;
    }
    if (frame.type !== "event" || !isNonEmptyString(frame.event, 128)) return;
    if (frame.seq !== undefined) {
      if (!Number.isSafeInteger(frame.seq) || frame.seq < 0) return;
      if (lastSequence !== null && frame.seq <= lastSequence) {
        safeSink(onAudit, { action: "gateway-frame", outcome: "rejected", reason: "stale_sequence" });
        return;
      }
      if (lastSequence !== null && frame.seq > lastSequence + 1) {
        const gap = Object.freeze({ expected: lastSequence + 1, received: frame.seq });
        safeSink(onAudit, { action: "gateway-event-gap", outcome: "detected", ...gap });
        try { onGap?.(gap); } catch { /* Consumer diagnostics cannot break delivery. */ }
      }
      lastSequence = frame.seq;
    }
    if (frame.event !== OPENCLAW_GATEWAY_CONTRACT.rpc.event) return;
    let event;
    try { event = sanitizeChatEvent(frame.payload); }
    catch {
      safeSink(onAudit, { action: "gateway-event", outcome: "rejected", event: "chat", reason: "invalid_chat_event" });
      return;
    }
    for (const listener of [...chatListeners]) {
      try { listener(event); } catch { /* One UI listener cannot block another. */ }
    }
  }

  function request(method, params, { signal, timeout = OPENCLAW_GATEWAY_CONTRACT.limits.requestTimeoutMs } = {}) {
    if (state !== "ready" || !socket || !hello) {
      return Promise.reject(fail("client_not_ready", "Gateway client is not ready"));
    }
    if (!OPENCLAW_GATEWAY_CONTRACT.rpc.methods.includes(method)) {
      return Promise.reject(fail("method_not_allowed", "Gateway RPC method is outside the generated contract"));
    }
    if (!hello.features.methods.includes(method)) {
      return Promise.reject(fail("method_unavailable", "Gateway did not advertise the requested RPC method"));
    }
    if (!Number.isSafeInteger(timeout) || timeout < 1_000 || timeout > 120_000) {
      return Promise.reject(new TypeError("Gateway RPC timeout is invalid"));
    }
    if (signal !== undefined && (typeof signal.aborted !== "boolean"
      || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) {
      return Promise.reject(new TypeError("Gateway RPC abort signal is invalid"));
    }
    if (signal?.aborted) return Promise.reject(fail("aborted", "Gateway RPC was aborted"));
    if (pendingRequests.size >= OPENCLAW_GATEWAY_CONTRACT.limits.maxPendingRequests) {
      return Promise.reject(fail("too_many_requests", "Gateway RPC pending-request limit reached"));
    }
    let id;
    try { id = nextRequestId("Gateway RPC request id"); }
    catch (error) { return Promise.reject(error); }
    let serialized;
    try { serialized = JSON.stringify({ type: "req", id, method, params }); }
    catch { return Promise.reject(new TypeError("Gateway RPC parameters are not JSON serializable")); }
    const maximum = Math.min(hello.policy.maxPayload, OPENCLAW_GATEWAY_CONTRACT.limits.authenticatedPayloadBytes);
    if (new TextEncoder().encode(serialized).byteLength > maximum) {
      return Promise.reject(fail("request_too_large", "Gateway RPC request exceeds the client payload limit"));
    }
    const startedAt = now();
    return new Promise((resolve, reject) => {
      const abort = () => {
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);
        clearTimeout(pending.timer);
        safeSink(onAudit, {
          action: "gateway-rpc",
          outcome: "failed",
          method,
          reason: "aborted",
          durationMs: Math.max(0, now() - startedAt)
        });
        reject(fail("aborted", "Gateway RPC was aborted"));
      };
      const timer = setTimeout(() => {
        const pending = pendingRequests.get(id);
        if (!pending) return;
        pendingRequests.delete(id);
        signal?.removeEventListener("abort", abort);
        safeSink(onAudit, {
          action: "gateway-rpc",
          outcome: "failed",
          method,
          reason: "request_timeout",
          durationMs: Math.max(0, now() - startedAt)
        });
        reject(fail("request_timeout", "Gateway RPC timed out"));
      }, timeout);
      pendingRequests.set(id, { method, resolve, reject, timer, signal, abort, startedAt });
      signal?.addEventListener("abort", abort, { once: true });
      safeSink(onAudit, { action: "gateway-rpc", outcome: "sent", method });
      try { socket.send(serialized); }
      catch {
        pendingRequests.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        safeSink(onAudit, {
          action: "gateway-rpc",
          outcome: "failed",
          method,
          reason: "request_send_failed",
          durationMs: Math.max(0, now() - startedAt)
        });
        reject(fail("request_send_failed", "Gateway RPC could not be sent"));
      }
    });
  }

  function connect({ signal } = {}) {
    if (state === "ready") return Promise.resolve(hello);
    if (state === "connecting") return inFlight;
    if (state === "closed") return Promise.reject(fail("client_closed", "Gateway client is closed"));
    if (signal?.aborted) return Promise.reject(fail("aborted", "Gateway handshake was aborted"));

    let authority;
    try { authority = resolveGatewayWebSocketConnection(getConnection(), origin); }
    catch (error) { return Promise.reject(error); }
    let requestId;
    try { requestId = nextRequestId("Gateway connect request id"); }
    catch (error) { return Promise.reject(error); }
    const startedAt = now();
    state = "connecting";
    safeSink(onAudit, { action: "gateway-handshake", outcome: "started", protocol: 4 });

    inFlight = new Promise((resolve, reject) => {
      let settled = false;
      let challengeHandled = false;
      let signedDeviceId;
      let usedStoredDeviceToken = false;
      const webSocketUrl = authority.url;
      let token = authority.token;
      authority = undefined;
      let timer;
      let activeSocket;

      const finishFailure = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        cancelHandshake = undefined;
        token = undefined;
        state = error.code === "aborted" ? "idle" : "failed";
        try { activeSocket?.close(1008, "handshake failed"); } catch { /* best effort */ }
        // Frames queued behind the failure must not reach authenticated
        // handling; detaching the socket makes every listener drop them.
        if (socket === activeSocket) socket = undefined;
        safeSink(onAudit, {
          action: "gateway-handshake",
          outcome: "failed",
          protocol: 4,
          reason: error.code ?? "handshake_failed",
          durationMs: Math.max(0, now() - startedAt)
        });
        reject(error);
      };
      const abort = () => finishFailure(fail("aborted", "Gateway handshake was aborted"));
      cancelHandshake = () => finishFailure(fail("client_closed", "Gateway client was closed during handshake"));
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () => finishFailure(fail("handshake_timeout", "Gateway handshake timed out")),
        timeoutMs
      );

      try { activeSocket = createWebSocket(webSocketUrl); socket = activeSocket; }
      catch { finishFailure(fail("websocket_open_failed", "Gateway WebSocket could not be opened")); return; }
      if (!activeSocket || typeof activeSocket.addEventListener !== "function" || typeof activeSocket.send !== "function"
        || typeof activeSocket.close !== "function") {
        finishFailure(fail("invalid_websocket", "WebSocket implementation is invalid"));
        return;
      }

      activeSocket.addEventListener("error", () => {
        if (socket !== activeSocket) return;
        if (!settled) finishFailure(fail("websocket_error", "Gateway WebSocket failed during handshake"));
      });
      activeSocket.addEventListener("close", (event) => {
        if (socket !== activeSocket) return;
        if (!settled) finishFailure(fail(
          "websocket_closed",
          `Gateway WebSocket closed during handshake (${Number.isInteger(event?.code) ? event.code : 1006})`
        ));
        else if (state === "ready") {
          state = "disconnected";
          socket = undefined;
          hello = undefined;
          lastSequence = null;
          flushPending(fail("connection_lost", "Gateway connection closed with pending RPC requests"));
          safeSink(onAudit, {
            action: "gateway-session",
            outcome: "disconnected",
            code: Number.isInteger(event?.code) ? event.code : 1006
          });
        }
      });
      activeSocket.addEventListener("message", async (event) => {
        if (socket !== activeSocket) return;
        if (typeof event?.data !== "string") {
          if (settled) {
            safeSink(onAudit, { action: "gateway-frame", outcome: "rejected", reason: "non_text_frame" });
            activeSocket.close(1003, "text frames required");
            return;
          }
          finishFailure(fail("invalid_frame", "Gateway sent a non-text handshake frame"));
          return;
        }
        const frameBytes = new TextEncoder().encode(event.data).byteLength;
        const maximum = settled && hello
          ? Math.min(hello.policy.maxPayload, OPENCLAW_GATEWAY_CONTRACT.limits.authenticatedPayloadBytes)
          : OPENCLAW_GATEWAY_CONTRACT.limits.preauthPayloadBytes;
        if (frameBytes > maximum) {
          if (settled) {
            safeSink(onAudit, { action: "gateway-frame", outcome: "rejected", reason: "frame_too_large" });
            activeSocket.close(1009, "frame too large");
            return;
          }
          finishFailure(fail("frame_too_large", "Gateway handshake frame exceeds the pre-authentication limit"));
          return;
        }
        let frame;
        try { frame = JSON.parse(event.data); }
        catch {
          if (settled) {
            safeSink(onAudit, { action: "gateway-frame", outcome: "rejected", reason: "invalid_json" });
            activeSocket.close(1007, "invalid JSON");
            return;
          }
          finishFailure(fail("invalid_frame", "Gateway sent invalid handshake JSON"));
          return;
        }
        if (settled) {
          if (state === "ready") handleAuthenticatedFrame(frame);
          return;
        }

        if (frame?.type === "event" && frame.event === "connect.challenge") {
          if (challengeHandled) {
            finishFailure(fail("duplicate_challenge", "Gateway sent more than one connect challenge"));
            return;
          }
          const nonce = frame.payload?.nonce;
          // "|" delimits the signed v3 payload; control characters and the
          // delimiter cannot be allowed into signature material.
          if (!isNonEmptyString(nonce, 512) || /[|\0\r\n]/u.test(nonce)) {
            finishFailure(fail("invalid_challenge", "Gateway connect challenge is missing a valid nonce"));
            return;
          }
          challengeHandled = true;
          const profile = OPENCLAW_GATEWAY_CONTRACT.profile;
          try {
            const descriptor = await verifiedIdentity.descriptor();
            if (!descriptor || !DEVICE_ID.test(descriptor.deviceId ?? "")) {
              throw new Error("identity descriptor returned an invalid device id");
            }
            let stored;
            try {
              stored = assertStoredDeviceToken(await verifiedDeviceTokenVault.load({
                deviceId: descriptor.deviceId,
                role: profile.role
              }));
            } catch {
              throw fail("device_token_load_failed", "encrypted Gateway device token could not be loaded");
            }
            const authenticationToken = stored?.token ?? token;
            usedStoredDeviceToken = Boolean(stored);
            const device = await verifiedIdentity.signConnect({
              clientId: profile.clientId,
              clientMode: profile.clientMode,
              role: profile.role,
              scopes: profile.scopes,
              token: authenticationToken,
              nonce,
              platform: profile.platform,
              deviceFamily: profile.deviceFamily
            });
            if (settled) return;
            if (!device || !DEVICE_ID.test(device.id ?? "") || device.nonce !== nonce
              || !isNonEmptyString(device.publicKey, 128) || !isNonEmptyString(device.signature, 256)
              || !Number.isSafeInteger(device.signedAt)) {
              throw new Error("identity signer returned an invalid device proof");
            }
            signedDeviceId = device.id;
            const connectRequest = {
              type: "req",
              id: requestId,
              method: "connect",
              params: {
                minProtocol: OPENCLAW_GATEWAY_CONTRACT.protocol.min,
                maxProtocol: OPENCLAW_GATEWAY_CONTRACT.protocol.max,
                client: {
                  id: profile.clientId,
                  version: profile.clientVersion,
                  platform: profile.platform,
                  deviceFamily: profile.deviceFamily,
                  mode: profile.clientMode
                },
                role: profile.role,
                scopes: profile.scopes,
                caps: profile.caps,
                auth: usedStoredDeviceToken
                  ? { deviceToken: authenticationToken }
                  : { token: authenticationToken },
                device
              }
            };
            const serialized = JSON.stringify(connectRequest);
            if (new TextEncoder().encode(serialized).byteLength > OPENCLAW_GATEWAY_CONTRACT.limits.preauthPayloadBytes) {
              throw fail("connect_frame_too_large", "Gateway connect frame exceeds the pre-authentication limit");
            }
            activeSocket.send(serialized);
            token = undefined;
            stored = undefined;
          } catch (error) {
            finishFailure(error instanceof OpenClawGatewayClientError
              ? error
              : fail("device_sign_failed", "browser device challenge signing failed"));
          }
          return;
        }

        if (frame?.type === "res" && frame.id === requestId) {
          if (!challengeHandled) {
            finishFailure(fail("response_before_challenge", "Gateway responded before device challenge signing"));
            return;
          }
          if (frame.ok !== true) {
            const detailCode = typeof frame.error?.details?.code === "string"
              ? frame.error.details.code
              : undefined;
            if (usedStoredDeviceToken && detailCode === "AUTH_DEVICE_TOKEN_MISMATCH" && signedDeviceId) {
              try {
                await verifiedDeviceTokenVault.clear({ deviceId: signedDeviceId, role: OPENCLAW_GATEWAY_CONTRACT.profile.role });
                safeSink(onAudit, {
                  action: "gateway-device-token",
                  outcome: "cleared",
                  reason: "token_mismatch"
                });
              } catch {
                finishFailure(fail("device_token_clear_failed", "rejected Gateway device token could not be cleared"));
                return;
              }
            }
            const pairing = pairingFrom(frame.error, signedDeviceId);
            finishFailure(fail(
              pairing ? "pairing_required" : "connect_rejected",
              pairing ? "Gateway requires explicit device pairing approval" : "Gateway rejected the authenticated connect request",
              {
                gatewayCode: typeof frame.error?.code === "string" && GATEWAY_CODE.test(frame.error.code)
                  ? frame.error.code
                  : undefined,
                pairing
              }
            ));
            return;
          }
          let parsedHello;
          try { parsedHello = parseHello(frame.payload, verifiedArtifact.version); }
          catch (error) { finishFailure(error); return; }
          if (parsedHello.deviceToken !== undefined) {
            try {
              await verifiedDeviceTokenVault.store({
                deviceId: signedDeviceId,
                role: parsedHello.hello.auth.role,
                token: parsedHello.deviceToken,
                scopes: parsedHello.hello.auth.scopes,
                ...(parsedHello.issuedAtMs === undefined ? {} : { issuedAtMs: parsedHello.issuedAtMs })
              });
              safeSink(onAudit, {
                action: "gateway-device-token",
                outcome: "stored",
                role: parsedHello.hello.auth.role,
                scopeCount: parsedHello.hello.auth.scopes.length
              });
            } catch {
              finishFailure(fail("device_token_store_failed", "issued Gateway device token could not be encrypted"));
              return;
            }
          }
          hello = Object.freeze({
            ...parsedHello.hello,
            auth: Object.freeze({
              ...parsedHello.hello.auth,
              deviceTokenStored: parsedHello.deviceToken !== undefined || usedStoredDeviceToken,
              authenticatedWith: usedStoredDeviceToken ? "device-token" : "shared-token"
            })
          });
          parsedHello = undefined;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          cancelHandshake = undefined;
          token = undefined;
          lastSequence = null;
          state = "ready";
          safeSink(onAudit, {
            action: "gateway-handshake",
            outcome: "ready",
            protocol: hello.protocol,
            serverVersion: hello.server.version,
            durationMs: Math.max(0, now() - startedAt),
            deviceTokenIssued: hello.auth.deviceTokenIssued
          });
          resolve(hello);
          return;
        }

        if (!challengeHandled) finishFailure(fail("unexpected_frame", "Gateway sent an unexpected pre-authentication frame"));
      });
    });
    return inFlight;
  }

  async function sendChat(params, options = {}) {
    const value = assertObject(params, "chat.send", new Set([
      "sessionKey",
      "agentId",
      "message",
      "thinking",
      "timeoutMs",
      "runId"
    ]));
    const requestOptions = assertObject(options, "chat.send options", new Set(["signal", "requestTimeoutMs"]));
    const sessionKey = assertSessionKey(value.sessionKey);
    const agentId = assertAgentId(value.agentId);
    if (typeof value.message !== "string" || value.message.length < 1 || value.message.length > 65_536
      || !NON_EMPTY.test(value.message) || value.message.includes("\0")) {
      throw new TypeError("chat message is invalid");
    }
    if (value.thinking !== undefined && (!isNonEmptyString(value.thinking, 64) || /[\0\r\n]/u.test(value.thinking))) {
      throw new TypeError("chat thinking mode is invalid");
    }
    if (value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs)
      || value.timeoutMs < 1_000 || value.timeoutMs > 120_000)) {
      throw new TypeError("chat run timeout is invalid");
    }
    const runId = value.runId === undefined
      ? nextRequestId("chat run id")
      : assertRunId(value.runId);
    const response = await request("chat.send", {
      sessionKey,
      ...(agentId === undefined ? {} : { agentId }),
      message: value.message,
      ...(value.thinking === undefined ? {} : { thinking: value.thinking }),
      deliver: false,
      ...(value.timeoutMs === undefined ? {} : { timeoutMs: value.timeoutMs }),
      idempotencyKey: runId
    }, {
      signal: requestOptions.signal,
      ...(requestOptions.requestTimeoutMs === undefined ? {} : { timeout: requestOptions.requestTimeoutMs })
    });
    if (!isRecord(response) || response.runId !== runId || !isNonEmptyString(response.status, 64)) {
      throw fail("invalid_chat_response", "Gateway returned an invalid chat.send acknowledgement");
    }
    return Object.freeze({ runId, status: response.status });
  }

  async function loadChatHistory(params, options = {}) {
    const value = assertObject(params, "chat.history", new Set(["sessionKey", "agentId", "limit", "maxChars"]));
    const requestOptions = assertObject(options, "chat.history options", new Set(["signal", "requestTimeoutMs"]));
    const sessionKey = assertSessionKey(value.sessionKey);
    const agentId = assertAgentId(value.agentId);
    const limit = value.limit ?? 50;
    const maxChars = value.maxChars ?? 200_000;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new TypeError("chat history limit is invalid");
    if (!Number.isSafeInteger(maxChars) || maxChars < 1 || maxChars > 1_000_000) {
      throw new TypeError("chat history character limit is invalid");
    }
    const response = await request("chat.history", {
      sessionKey,
      ...(agentId === undefined ? {} : { agentId }),
      limit,
      maxChars
    }, {
      signal: requestOptions.signal,
      ...(requestOptions.requestTimeoutMs === undefined ? {} : { timeout: requestOptions.requestTimeoutMs })
    });
    if (!isRecord(response) || !Array.isArray(response.messages) || response.messages.length > limit) {
      throw fail("invalid_chat_response", "Gateway returned an invalid chat.history payload");
    }
    return Object.freeze({ ...response, messages: Object.freeze([...response.messages]) });
  }

  async function abortChat(params, options = {}) {
    const value = assertObject(params, "chat.abort", new Set(["sessionKey", "agentId", "runId"]));
    const requestOptions = assertObject(options, "chat.abort options", new Set(["signal", "requestTimeoutMs"]));
    const sessionKey = assertSessionKey(value.sessionKey);
    const agentId = assertAgentId(value.agentId);
    const runId = value.runId === undefined ? undefined : assertRunId(value.runId);
    const response = await request("chat.abort", {
      sessionKey,
      ...(agentId === undefined ? {} : { agentId }),
      ...(runId === undefined ? {} : { runId })
    }, {
      signal: requestOptions.signal,
      timeout: requestOptions.requestTimeoutMs ?? 15_000
    });
    if (!isRecord(response) || response.ok !== true || typeof response.aborted !== "boolean"
      || !Array.isArray(response.runIds) || response.runIds.length > 64
      || !response.runIds.every((id) => typeof id === "string" && SAFE_REQUEST_ID.test(id))) {
      throw fail("invalid_chat_response", "Gateway returned an invalid chat.abort payload");
    }
    if (runId && response.aborted && !response.runIds.includes(runId)) {
      throw fail("invalid_chat_response", "Gateway abort response did not include the requested run");
    }
    return Object.freeze({
      ok: true,
      aborted: response.aborted,
      runIds: Object.freeze([...response.runIds])
    });
  }

  const chat = Object.freeze({
    send: sendChat,
    history: loadChatHistory,
    abort: abortChat,
    onEvent(listener) {
      if (typeof listener !== "function") throw new TypeError("chat event listener is invalid");
      chatListeners.add(listener);
      return () => chatListeners.delete(listener);
    }
  });

  const deviceAuth = Object.freeze({
    async metadata() {
      const descriptor = await verifiedIdentity.descriptor();
      return verifiedDeviceTokenVault.metadata({
        deviceId: descriptor.deviceId,
        role: OPENCLAW_GATEWAY_CONTRACT.profile.role
      });
    },
    async clear() {
      const descriptor = await verifiedIdentity.descriptor();
      const cleared = await verifiedDeviceTokenVault.clear({
        deviceId: descriptor.deviceId,
        role: OPENCLAW_GATEWAY_CONTRACT.profile.role
      });
      safeSink(onAudit, {
        action: "gateway-device-token",
        outcome: cleared ? "cleared" : "unchanged",
        reason: "explicit_local_clear"
      });
      return cleared;
    }
  });

  return Object.freeze({
    schemaVersion: 1,
    contract: OPENCLAW_GATEWAY_CONTRACT,
    get state() { return state; },
    connect,
    chat,
    deviceAuth,
    close() {
      if (state === "closed") return false;
      const cancel = cancelHandshake;
      cancelHandshake = undefined;
      cancel?.();
      state = "closed";
      flushPending(fail("client_closed", "Gateway client closed with pending RPC requests"));
      try { socket?.close(1000, "Clawsembly session closed"); } catch { /* best effort */ }
      socket = undefined;
      hello = undefined;
      lastSequence = null;
      chatListeners.clear();
      safeSink(onAudit, { action: "gateway-session", outcome: "closed" });
      return true;
    }
  });
}
