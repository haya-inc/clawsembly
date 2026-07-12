import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";

const NON_EMPTY = /\S/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^[a-f0-9]{64}$/u;

export class OpenClawGatewayClientError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "OpenClawGatewayClientError";
    this.code = code;
    if (options.gatewayCode) this.gatewayCode = options.gatewayCode;
    if (options.pairing) this.pairing = options.pairing;
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

export function resolveGatewayWebSocketConnection(connection, browserOrigin) {
  if (!connection || connection.schemaVersion !== 1 || connection.auth?.mode !== "token"
    || !isNonEmptyString(connection.auth.token, 512) || connection.auth.token.length < 16
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

function sanitizeHello(payload, artifactVersion) {
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
  return Object.freeze({
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
      deviceTokenIssued: isNonEmptyString(payload.auth.deviceToken, 2_048)
    }),
    policy: Object.freeze({
      maxPayload: payload.policy.maxPayload,
      maxBufferedBytes: payload.policy.maxBufferedBytes,
      tickIntervalMs: payload.policy.tickIntervalMs
    })
  });
}

export function createOpenClawGatewayClient({
  artifact,
  getConnection,
  identity,
  browserOrigin = globalThis.location?.origin,
  createWebSocket = (url) => new WebSocket(url),
  requestIdFactory = () => globalThis.crypto.randomUUID(),
  timeoutMs = OPENCLAW_GATEWAY_CONTRACT.limits.handshakeTimeoutMs,
  onAudit,
  now = Date.now
}) {
  const verifiedArtifact = assertArtifact(artifact);
  if (typeof getConnection !== "function") throw new TypeError("Gateway connection supplier is required");
  const verifiedIdentity = assertIdentity(identity);
  const origin = exactOrigin(browserOrigin);
  if (!origin) throw new TypeError("an exact browser origin is required");
  if (typeof createWebSocket !== "function") throw new TypeError("WebSocket factory is invalid");
  if (typeof requestIdFactory !== "function") throw new TypeError("request id factory is invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("Gateway handshake timeout is invalid");
  }
  if (onAudit !== undefined && typeof onAudit !== "function") throw new TypeError("Gateway client audit sink is invalid");
  if (typeof now !== "function") throw new TypeError("Gateway client clock is invalid");

  let state = "idle";
  let socket;
  let inFlight;
  let hello;
  let cancelHandshake;

  function connect({ signal } = {}) {
    if (state === "ready") return Promise.resolve(hello);
    if (state === "connecting") return inFlight;
    if (state === "closed") return Promise.reject(fail("client_closed", "Gateway client is closed"));
    if (signal?.aborted) return Promise.reject(fail("aborted", "Gateway handshake was aborted"));

    let authority;
    try { authority = resolveGatewayWebSocketConnection(getConnection(), origin); }
    catch (error) { return Promise.reject(error); }
    const requestId = requestIdFactory();
    if (typeof requestId !== "string" || !SAFE_REQUEST_ID.test(requestId)) {
      return Promise.reject(new TypeError("Gateway connect request id is invalid"));
    }
    const startedAt = now();
    state = "connecting";
    safeSink(onAudit, { action: "gateway-handshake", outcome: "started", protocol: 4 });

    inFlight = new Promise((resolve, reject) => {
      let settled = false;
      let challengeHandled = false;
      let signedDeviceId;
      const webSocketUrl = authority.url;
      let token = authority.token;
      authority = undefined;
      let timer;

      const finishFailure = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        cancelHandshake = undefined;
        token = undefined;
        state = error.code === "aborted" ? "idle" : "failed";
        try { socket?.close(1008, "handshake failed"); } catch { /* best effort */ }
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

      try { socket = createWebSocket(webSocketUrl); }
      catch { finishFailure(fail("websocket_open_failed", "Gateway WebSocket could not be opened")); return; }
      if (!socket || typeof socket.addEventListener !== "function" || typeof socket.send !== "function"
        || typeof socket.close !== "function") {
        finishFailure(fail("invalid_websocket", "WebSocket implementation is invalid"));
        return;
      }

      socket.addEventListener("error", () => {
        if (!settled) finishFailure(fail("websocket_error", "Gateway WebSocket failed during handshake"));
      });
      socket.addEventListener("close", (event) => {
        if (!settled) finishFailure(fail(
          "websocket_closed",
          `Gateway WebSocket closed during handshake (${Number.isInteger(event?.code) ? event.code : 1006})`
        ));
        else if (state === "ready") {
          state = "closed";
          safeSink(onAudit, { action: "gateway-session", outcome: "closed" });
        }
      });
      socket.addEventListener("message", async (event) => {
        if (settled || typeof event?.data !== "string") {
          if (!settled) finishFailure(fail("invalid_frame", "Gateway sent a non-text handshake frame"));
          return;
        }
        if (new TextEncoder().encode(event.data).byteLength > OPENCLAW_GATEWAY_CONTRACT.limits.preauthPayloadBytes) {
          finishFailure(fail("frame_too_large", "Gateway handshake frame exceeds the pre-authentication limit"));
          return;
        }
        let frame;
        try { frame = JSON.parse(event.data); }
        catch { finishFailure(fail("invalid_frame", "Gateway sent invalid handshake JSON")); return; }

        if (frame?.type === "event" && frame.event === "connect.challenge") {
          if (challengeHandled) {
            finishFailure(fail("duplicate_challenge", "Gateway sent more than one connect challenge"));
            return;
          }
          const nonce = frame.payload?.nonce;
          if (!isNonEmptyString(nonce, 512)) {
            finishFailure(fail("invalid_challenge", "Gateway connect challenge is missing a valid nonce"));
            return;
          }
          challengeHandled = true;
          const profile = OPENCLAW_GATEWAY_CONTRACT.profile;
          try {
            const device = await verifiedIdentity.signConnect({
              clientId: profile.clientId,
              clientMode: profile.clientMode,
              role: profile.role,
              scopes: profile.scopes,
              token,
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
            const request = {
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
                auth: { token },
                device
              }
            };
            const serialized = JSON.stringify(request);
            if (new TextEncoder().encode(serialized).byteLength > OPENCLAW_GATEWAY_CONTRACT.limits.preauthPayloadBytes) {
              throw fail("connect_frame_too_large", "Gateway connect frame exceeds the pre-authentication limit");
            }
            socket.send(serialized);
            token = undefined;
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
            const pairing = pairingFrom(frame.error, signedDeviceId);
            finishFailure(fail(
              pairing ? "pairing_required" : "connect_rejected",
              pairing ? "Gateway requires explicit device pairing approval" : "Gateway rejected the authenticated connect request",
              {
                gatewayCode: typeof frame.error?.code === "string" ? frame.error.code : undefined,
                pairing
              }
            ));
            return;
          }
          try { hello = sanitizeHello(frame.payload, verifiedArtifact.version); }
          catch (error) { finishFailure(error); return; }
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          cancelHandshake = undefined;
          token = undefined;
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

  return Object.freeze({
    schemaVersion: 1,
    contract: OPENCLAW_GATEWAY_CONTRACT,
    get state() { return state; },
    connect,
    close() {
      if (state === "closed") return false;
      const cancel = cancelHandshake;
      cancelHandshake = undefined;
      cancel?.();
      state = "closed";
      try { socket?.close(1000, "Clawsembly session closed"); } catch { /* best effort */ }
      socket = undefined;
      hello = undefined;
      safeSink(onAudit, { action: "gateway-session", outcome: "closed" });
      return true;
    }
  });
}
