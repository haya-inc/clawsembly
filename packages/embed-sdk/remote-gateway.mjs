// Remote-mode embedding surface (ADR 0006, decision 1.ii): "connect your
// OpenClaw". The embedding page talks to a Gateway the user already
// operates elsewhere, through the same generated, version-locked client,
// persistent browser device identity, encrypted device-token vault,
// pairing-review surface, and payload-free audit as the browser-local
// lane. This is interoperability only: nothing runs browser-locally here,
// and a remote connection can never satisfy the ADR 0002 browser-local
// acceptance gates or stand in for BrowserPod runtime evidence.

import { createOpenClawGatewayClient } from "./gateway-client.mjs";
import { createBrowserDeviceIdentity } from "./gateway-device-identity.mjs";
import { createGatewayDeviceTokenVault } from "./gateway-device-token-vault.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "./openclaw-gateway-contract.generated.mjs";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "[::1]", "localhost"]);
const MAX_ALLOWED_ORIGINS = 16;

function exactOrigin(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.origin === value && !url.username && !url.password ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validates a user-supplied Gateway endpoint and token into the client's
 * remote-gateway connection material. HTTP(S) schemes are normalized onto
 * their WebSocket counterparts; cleartext endpoints are admissible only on
 * the loopback host — a remote Gateway must be reachable over TLS.
 */
export function createRemoteGatewayConnection({ url, token, allowedOrigins } = {}) {
  if (typeof url !== "string" || url.length === 0 || url.length > 2_048) {
    throw new TypeError("remote Gateway endpoint URL is required");
  }
  let endpoint;
  try { endpoint = new URL(url); }
  catch { throw new TypeError("remote Gateway endpoint URL is invalid"); }
  if (endpoint.username || endpoint.password) {
    throw new TypeError("remote Gateway endpoint must not carry credentials");
  }
  if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
  else if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
  if (endpoint.protocol !== "wss:" && endpoint.protocol !== "ws:") {
    throw new TypeError("remote Gateway endpoint must be an HTTP(S) or WebSocket URL");
  }
  const loopback = LOOPBACK_HOSTNAMES.has(endpoint.hostname);
  if (endpoint.protocol === "ws:" && !loopback) {
    throw new TypeError("cleartext Gateway endpoints are limited to the loopback host");
  }
  endpoint.hash = "";
  if (typeof token !== "string" || token.length < 16 || token.length > 512
    || /[|\0\r\n\s]/u.test(token)) {
    throw new TypeError("remote Gateway token is invalid");
  }
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length < 1
    || allowedOrigins.length > MAX_ALLOWED_ORIGINS) {
    throw new TypeError("remote Gateway allowed origins are required");
  }
  const origins = allowedOrigins.map((origin) => {
    const exact = exactOrigin(origin);
    if (!exact) throw new TypeError("remote Gateway allowed origins must be exact origins");
    return exact;
  });
  return Object.freeze({
    schemaVersion: 1,
    kind: "remote-gateway",
    auth: Object.freeze({ mode: "token", token }),
    gateway: Object.freeze({ url: endpoint.href, loopback }),
    allowedOrigins: Object.freeze(origins)
  });
}

/**
 * Opens the generated Gateway client against a user-operated Gateway with
 * browser-persistent defaults: IndexedDB-backed device identity and the
 * encrypted device-token vault. The client stays version-locked to the
 * generated contract's exact artifact — a Gateway running any other
 * OpenClaw version fails closed with `server_version_mismatch` — and its
 * RPC surface stays limited to the generated contract's chat methods.
 */
export function connectRemoteOpenClawGateway({
  connection,
  getConnection,
  browserOrigin = globalThis.location?.origin,
  identity,
  deviceTokenVault,
  createWebSocket,
  timeoutMs,
  deviceManagement,
  onAudit,
  onGap,
  now
} = {}) {
  if ((connection === undefined) === (getConnection === undefined)) {
    throw new TypeError("exactly one of connection or getConnection is required");
  }
  if (connection !== undefined && connection?.kind !== "remote-gateway") {
    throw new TypeError("remote Gateway connection material is required");
  }
  if (getConnection !== undefined && typeof getConnection !== "function") {
    throw new TypeError("remote Gateway connection supplier is invalid");
  }
  return createOpenClawGatewayClient({
    artifact: OPENCLAW_GATEWAY_CONTRACT.artifact,
    getConnection: getConnection ?? (() => connection),
    // The browser-persistent defaults construct only after input validation:
    // IndexedDB-backed device identity and the encrypted device-token vault.
    identity: identity ?? createBrowserDeviceIdentity(),
    deviceTokenVault: deviceTokenVault ?? createGatewayDeviceTokenVault(),
    browserOrigin,
    ...(createWebSocket === undefined ? {} : { createWebSocket }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(deviceManagement === undefined ? {} : { deviceManagement }),
    ...(onAudit === undefined ? {} : { onAudit }),
    ...(onGap === undefined ? {} : { onGap }),
    ...(now === undefined ? {} : { now })
  });
}
