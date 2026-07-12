import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { startCooperativeProcess } from "./cooperative-process.mjs";

export const OPENCLAW_GATEWAY_PORT = 18_789;
export const BROWSERPOD_HEALTH_PREFIX = "[clawsembly-browserpod-health]";
const PAIRING_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const PAIRING_REASONS = new Set(["not-paired", "role-upgrade", "scope-upgrade", "metadata-upgrade"]);
const REVIEW_TTL_MS = 5 * 60_000;

export const BROWSERPOD_HEALTH_SOURCE = String.raw`
const port = Number(process.argv[1]);
const result = {};
for (const endpoint of ["healthz", "readyz"]) {
  let lastError = "not ready";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/" + endpoint);
      const body = (await response.text()).slice(0, 4096);
      if (response.status === 200) {
        result[endpoint] = { status: response.status, body };
        break;
      }
      lastError = "HTTP " + response.status;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!result[endpoint]) {
    console.error(endpoint + ": " + lastError);
    process.exit(1);
  }
}
console.log("${BROWSERPOD_HEALTH_PREFIX}" + JSON.stringify(result));
`;

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new BrowserRuntimeError("invalid_gateway_output", `${label} is not valid JSON`); }
}

export function parseBrowserPodHealthEvidence(output) {
  const line = output.split(/\r?\n/u).find((entry) => entry.includes(BROWSERPOD_HEALTH_PREFIX));
  if (!line) throw new BrowserRuntimeError("health_probe_failed", "BrowserPod Gateway health evidence is missing");
  const value = parseJson(
    line.slice(line.indexOf(BROWSERPOD_HEALTH_PREFIX) + BROWSERPOD_HEALTH_PREFIX.length),
    "BrowserPod Gateway health evidence"
  );
  for (const endpoint of ["healthz", "readyz"]) {
    if (value?.[endpoint]?.status !== 200 || typeof value[endpoint].body !== "string"
      || value[endpoint].body.length > 4_096) {
      throw new BrowserRuntimeError("health_probe_failed", `BrowserPod Gateway ${endpoint} did not pass`);
    }
  }
  return value;
}

export function assertOpenClawGatewayPort(port) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("the OpenClaw Gateway port is invalid");
  }
  return port;
}

export function assertOpenClawGatewayToken(token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 512 || token.includes("\0")) {
    throw new TypeError("an ephemeral Gateway token of at least 16 characters is required");
  }
  return token;
}

function isLoopbackHostname(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function assertOpenClawBrowserOrigins(origins) {
  if (!Array.isArray(origins) || origins.length > 8) {
    throw new TypeError("OpenClaw browser origins must be a bounded array");
  }
  const normalized = [];
  for (const value of origins) {
    if (typeof value !== "string" || value === "*" || value.length > 512) {
      throw new TypeError("an exact OpenClaw browser origin is required");
    }
    let url;
    try { url = new URL(value); }
    catch { throw new TypeError("an exact OpenClaw browser origin is required"); }
    if (url.origin !== value || url.username || url.password
      || (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHostname(url.hostname)))) {
      throw new TypeError("an exact HTTPS or loopback OpenClaw browser origin is required");
    }
    if (!normalized.includes(url.origin)) normalized.push(url.origin);
  }
  return Object.freeze(normalized);
}

function safeSink(sink, value) {
  try { sink?.(Object.freeze(value)); }
  catch { /* Diagnostics cannot break the Gateway lifecycle. */ }
}

function normalizePairingStrings(value, label, { min = 0, max = 64 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max
    || value.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 512
      || /[\0\r\n]/u.test(entry))) {
    throw new BrowserRuntimeError("invalid_pairing_state", `${label} is invalid`);
  }
  return Object.freeze([...new Set(value)].sort());
}

function requestedRoles(record) {
  const values = [
    ...(Array.isArray(record?.roles) ? record.roles : []),
    ...(typeof record?.role === "string" ? [record.role] : [])
  ];
  return normalizePairingStrings(values, "pending pairing roles", { min: 1 });
}

function approvedAccess(record) {
  if (!record) return null;
  return Object.freeze({
    roles: requestedRoles(record),
    scopes: normalizePairingStrings(record.scopes ?? record.approvedScopes ?? [], "approved pairing scopes")
  });
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertPairingProfile(profile) {
  if (!profile || typeof profile.role !== "string" || profile.role.length < 1 || profile.role.length > 64
    || /[\0\r\n]/u.test(profile.role)) {
    throw new TypeError("Gateway pairing profile role is invalid");
  }
  const scopes = normalizePairingStrings(profile.scopes, "Gateway pairing profile scopes", { min: 1 });
  return Object.freeze({ role: profile.role, scopes });
}

function assertPairingRequirement(requirement, profile) {
  if (!requirement || requirement.required !== true || !PAIRING_REQUEST_ID.test(requirement.requestId ?? "")
    || !DEVICE_ID.test(requirement.deviceId ?? "") || !PAIRING_REASONS.has(requirement.reason)
    || requirement.role !== profile.role) {
    throw new BrowserRuntimeError("invalid_pairing_requirement", "Gateway pairing requirement is incomplete or invalid");
  }
  const scopes = normalizePairingStrings(requirement.scopes, "Gateway pairing requirement scopes", { min: 1 });
  if (!sameStrings(scopes, profile.scopes)) {
    throw new BrowserRuntimeError("pairing_scope_mismatch", "Gateway pairing requirement exceeds the generated client profile");
  }
  return Object.freeze({
    requestId: requirement.requestId,
    deviceId: requirement.deviceId,
    reason: requirement.reason,
    role: requirement.role,
    scopes
  });
}

function pairingSnapshot(list, requirement, profile) {
  if (!list || typeof list !== "object" || !Array.isArray(list.pending) || list.pending.length > 1_000
    || !Array.isArray(list.paired) || list.paired.length > 1_000) {
    throw new BrowserRuntimeError("invalid_pairing_state", "OpenClaw returned an invalid device pairing list");
  }
  const pending = list.pending.find((entry) => entry?.requestId === requirement.requestId);
  if (!pending) throw new BrowserRuntimeError("pairing_request_stale", "Gateway pairing request is no longer pending");
  if (pending.deviceId !== requirement.deviceId || !DEVICE_ID.test(pending.deviceId ?? "")) {
    throw new BrowserRuntimeError("pairing_device_mismatch", "Gateway pairing request device does not match the signed browser identity");
  }
  const roles = requestedRoles(pending);
  const scopes = normalizePairingStrings(pending.scopes ?? [], "pending pairing scopes", { min: 1 });
  if (!sameStrings(roles, [profile.role]) || !sameStrings(scopes, profile.scopes)) {
    throw new BrowserRuntimeError("pairing_scope_mismatch", "pending Gateway pairing access exceeds the generated client profile");
  }
  const paired = list.paired.find((entry) => entry?.deviceId === requirement.deviceId);
  return Object.freeze({
    requestId: requirement.requestId,
    deviceId: requirement.deviceId,
    reason: requirement.reason,
    requested: Object.freeze({ roles, scopes }),
    approved: approvedAccess(paired)
  });
}

function sameSnapshot(left, right) {
  return left.requestId === right.requestId && left.deviceId === right.deviceId
    && sameStrings(left.requested.roles, right.requested.roles)
    && sameStrings(left.requested.scopes, right.requested.scopes);
}

export function createVerifiedOpenClawGateway({
  runtime,
  installer,
  port = OPENCLAW_GATEWAY_PORT,
  allowedOrigins = [],
  tokenFactory = () => `clawsembly-${globalThis.crypto.randomUUID()}`,
  supervisorNonceFactory,
  pairingProfile,
  approvalIdFactory = () => globalThis.crypto.randomUUID(),
  onOutput,
  onAudit,
  now = Date.now
}) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.start !== "function"
    || typeof runtime.waitForPortal !== "function") {
    throw new TypeError("a BrowserPod runtime is required for the verified Gateway");
  }
  if (!installer || typeof installer.install !== "function" || !installer.artifact
    || typeof installer.root !== "string" || typeof installer.stateRoot !== "string"
    || typeof installer.executablePath !== "string") {
    throw new TypeError("a verified OpenClaw installer is required for the Gateway");
  }
  const gatewayPort = assertOpenClawGatewayPort(port);
  const browserOrigins = assertOpenClawBrowserOrigins(allowedOrigins);
  if (typeof tokenFactory !== "function") throw new TypeError("Gateway token factory is invalid");
  if (supervisorNonceFactory !== undefined && typeof supervisorNonceFactory !== "function") {
    throw new TypeError("Gateway supervisor nonce factory is invalid");
  }
  const verifiedPairingProfile = pairingProfile === undefined ? undefined : assertPairingProfile(pairingProfile);
  if (typeof approvalIdFactory !== "function") throw new TypeError("Gateway pairing approval id factory is invalid");
  if (onOutput !== undefined && typeof onOutput !== "function") throw new TypeError("Gateway output sink is invalid");
  if (onAudit !== undefined && typeof onAudit !== "function") throw new TypeError("Gateway audit sink is invalid");
  if (typeof now !== "function") throw new TypeError("Gateway clock is invalid");

  let state = "idle";
  let inFlight;
  let active;
  let readyResult;
  let authToken;
  let lastTask;
  const pairingReviews = new Map();

  async function runDevicesCommand(args) {
    if (state !== "ready" || !readyResult) {
      throw new BrowserRuntimeError("gateway_not_ready", "OpenClaw Gateway pairing is unavailable");
    }
    const task = await runtime.start({
      executable: "node",
      args: [installer.executablePath, "--dev", "devices", ...args, "--json"],
      cwd: installer.root,
      env: [
        "CI=1",
        "NO_COLOR=1",
        `OPENCLAW_STATE_DIR=${installer.stateRoot}`,
        `OPENCLAW_GATEWAY_TOKEN=${authToken}`
      ],
      outputLimitBytes: 128 * 1024,
      echo: false
    });
    const completion = await task.wait();
    if (completion.status !== "completed" || task.outputTruncated) {
      throw new BrowserRuntimeError("pairing_command_failed", "OpenClaw device pairing command failed");
    }
    return parseJson(task.transcript.trim(), "OpenClaw device pairing command output");
  }

  async function currentPairingSnapshot(requirement) {
    return pairingSnapshot(await runDevicesCommand(["list"]), requirement, verifiedPairingProfile);
  }

  async function decidePairing(reviewId, decision) {
    if (!verifiedPairingProfile || !PAIRING_REQUEST_ID.test(reviewId ?? "")) {
      throw new BrowserRuntimeError("invalid_pairing_review", "Gateway pairing review id is invalid");
    }
    const retained = pairingReviews.get(reviewId);
    if (!retained) throw new BrowserRuntimeError("pairing_review_stale", "Gateway pairing review is missing or already used");
    pairingReviews.delete(reviewId);
    if (now() >= retained.expiresAtMs) {
      throw new BrowserRuntimeError("pairing_review_expired", "Gateway pairing review has expired");
    }
    const current = await currentPairingSnapshot(retained.requirement);
    if (!sameSnapshot(current, retained.snapshot)) {
      throw new BrowserRuntimeError("pairing_request_changed", "Gateway pairing request changed after owner review");
    }
    const result = await runDevicesCommand([decision === "approved" ? "approve" : "reject", current.requestId]);
    const requestId = result?.requestId ?? current.requestId;
    const deviceId = result?.device?.deviceId ?? result?.deviceId;
    if (requestId !== current.requestId || deviceId !== current.deviceId) {
      throw new BrowserRuntimeError("invalid_pairing_result", "OpenClaw returned an invalid pairing decision result");
    }
    safeSink(onAudit, {
      action: "gateway-pairing",
      outcome: decision,
      reason: current.reason,
      roleCount: current.requested.roles.length,
      scopeCount: current.requested.scopes.length
    });
    return Object.freeze({
      schemaVersion: 1,
      decision,
      requestId: current.requestId,
      deviceId: current.deviceId
    });
  }

  async function performStart(token) {
    const installed = await installer.install();
    const startedAt = now();
    safeSink(onAudit, {
      action: "gateway",
      outcome: "starting",
      package: installed.artifact.package,
      version: installed.artifact.version,
      port: gatewayPort
    });
    let supervised;
    try {
      if (browserOrigins.length > 0) {
        const configuration = await runtime.start({
          executable: "node",
          args: [
            installed.executablePath,
            "--dev",
            "config",
            "set",
            "gateway.controlUi.allowedOrigins",
            JSON.stringify(browserOrigins),
            "--strict-json"
          ],
          cwd: installed.root,
          env: ["CI=1", "NO_COLOR=1", `OPENCLAW_STATE_DIR=${installed.stateRoot}`],
          outputLimitBytes: 64 * 1024
        });
        configuration.onOutput((chunk) => safeSink(onOutput, { phase: "configure", chunk }));
        const configured = await configuration.wait();
        if (configured.status !== "completed") {
          throw new BrowserRuntimeError("origin_config_failed", "OpenClaw browser origin configuration failed");
        }
        safeSink(onAudit, {
          action: "gateway-origin-policy",
          outcome: "configured",
          count: browserOrigins.length,
          taskId: configuration.id
        });
      }
      supervised = await startCooperativeProcess({
        runtime,
        root: `${installed.root}/supervision`,
        id: "gateway",
        command: {
          executable: "node",
          args: [
            installed.executablePath,
            "--dev",
            "gateway",
            "--allow-unconfigured",
            "--bind",
            "loopback",
            "--port",
            String(gatewayPort),
            "--auth",
            "token"
          ],
          cwd: installed.root,
          env: [
            "CI=1",
            "NO_COLOR=1",
            "OPENCLAW_SKIP_CHANNELS=1",
            `OPENCLAW_STATE_DIR=${installed.stateRoot}`,
            `OPENCLAW_GATEWAY_TOKEN=${token}`
          ],
          outputLimitBytes: 2 * 1024 * 1024
        },
        ...(supervisorNonceFactory ? { nonceFactory: supervisorNonceFactory } : {})
      });
      active = supervised;
      lastTask = supervised.task;
      lastTask.onOutput((chunk) => safeSink(onOutput, { phase: "gateway", chunk }));

      const readinessController = new AbortController();
      const readiness = Promise.all([
        runtime.waitForPortal(gatewayPort, { timeoutMs: 60_000, signal: readinessController.signal }),
        lastTask.waitForOutput("[gateway] ready", { timeoutMs: 60_000, signal: readinessController.signal })
      ]).then(([portal]) => ({ kind: "ready", portal }));
      let gatewayOutcome;
      try {
        gatewayOutcome = await Promise.race([
          readiness,
          lastTask.wait().then((completion) => ({ kind: "exit", completion }))
        ]);
      } catch (error) {
        readinessController.abort();
        throw error;
      }
      if (gatewayOutcome.kind === "exit") {
        readinessController.abort();
        throw new BrowserRuntimeError(
          "gateway_exited",
          `OpenClaw Gateway exited before readiness (${gatewayOutcome.completion.status})`
        );
      }
      readinessController.abort();

      const healthTask = await runtime.start({
        executable: "node",
        args: ["--input-type=module", "-e", BROWSERPOD_HEALTH_SOURCE, String(gatewayPort)],
        cwd: installed.root,
        env: ["NO_COLOR=1"],
        outputLimitBytes: 64 * 1024
      });
      healthTask.onOutput((chunk) => safeSink(onOutput, { phase: "health", chunk }));
      const healthCompletion = await healthTask.wait();
      if (healthCompletion.status !== "completed") {
        throw new BrowserRuntimeError("health_probe_failed", "BrowserPod Gateway health probe failed");
      }
      const health = parseBrowserPodHealthEvidence(healthTask.transcript);
      const result = Object.freeze({
        schemaVersion: 1,
        artifact: installed.artifact,
        port: gatewayPort,
        bind: "loopback",
        auth: "token",
        allowedOrigins: browserOrigins,
        portal: gatewayOutcome.portal,
        healthz: Object.freeze(health.healthz),
        readyz: Object.freeze(health.readyz),
        taskId: lastTask.id,
        durationMs: Math.max(0, now() - startedAt),
        outputTruncated: lastTask.outputTruncated
      });
      safeSink(onAudit, {
        action: "gateway",
        outcome: "ready",
        package: result.artifact.package,
        version: result.artifact.version,
        port: result.port,
        taskId: result.taskId,
        durationMs: result.durationMs,
        outputTruncated: result.outputTruncated,
        portalVisibility: result.portal.visibility,
        allowedOriginCount: result.allowedOrigins.length
      });
      return result;
    } catch (error) {
      let cleaned = false;
      if (supervised) {
        try { cleaned = (await supervised.stop({ timeoutMs: 15_000 })).complete; }
        catch { /* Preserve the readiness failure and retain a cleanup handle. */ }
      }
      active = cleaned ? undefined : supervised;
      authToken = undefined;
      safeSink(onAudit, {
        action: "gateway",
        outcome: "failed",
        package: installer.artifact.package,
        version: installer.artifact.version,
        port: gatewayPort,
        reason: error instanceof BrowserRuntimeError ? error.code : "gateway_failed"
      });
      throw error;
    }
  }

  const gateway = {
    schemaVersion: 1,
    artifact: installer.artifact,
    port: gatewayPort,
    allowedOrigins: browserOrigins,
    get state() { return state; },
    start() {
      if (state === "ready") return Promise.resolve(readyResult);
      if (state === "starting") return inFlight;
      if (state === "stopping") {
        return Promise.reject(new BrowserRuntimeError("gateway_stopping", "OpenClaw Gateway is stopping"));
      }
      if (state === "failed" && active) {
        return Promise.reject(new BrowserRuntimeError(
          "gateway_cleanup_required",
          "OpenClaw Gateway cleanup is required before restart"
        ));
      }
      const token = assertOpenClawGatewayToken(tokenFactory());
      authToken = token;
      state = "starting";
      inFlight = performStart(token).then(
        (result) => {
          readyResult = result;
          state = "ready";
          return result;
        },
        (error) => {
          state = "failed";
          throw error;
        }
      );
      return inFlight;
    },
    connection() {
      if (state !== "ready" || !readyResult || !authToken) {
        throw new BrowserRuntimeError("gateway_not_ready", "OpenClaw Gateway connection is unavailable");
      }
      safeSink(onAudit, {
        action: "gateway-connection",
        outcome: "issued",
        port: gatewayPort,
        taskId: readyResult.taskId
      });
      return Object.freeze({
        schemaVersion: 1,
        portal: readyResult.portal,
        allowedOrigins: browserOrigins,
        auth: Object.freeze({ mode: "token", token: authToken })
      });
    },
    pairing: Object.freeze({
      async review(untrustedRequirement) {
        if (!verifiedPairingProfile) {
          throw new BrowserRuntimeError("pairing_unavailable", "Gateway pairing profile is not configured");
        }
        const requirement = assertPairingRequirement(untrustedRequirement, verifiedPairingProfile);
        const snapshot = await currentPairingSnapshot(requirement);
        let reviewId;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const candidate = approvalIdFactory();
          if (typeof candidate === "string" && PAIRING_REQUEST_ID.test(candidate) && !pairingReviews.has(candidate)) {
            reviewId = candidate;
            break;
          }
        }
        if (!reviewId) throw new BrowserRuntimeError("pairing_review_id_failed", "Gateway pairing review id is invalid or duplicated");
        const createdAtMs = now();
        if (!Number.isFinite(createdAtMs)) throw new BrowserRuntimeError("invalid_clock", "Gateway pairing review clock is invalid");
        const expiresAtMs = createdAtMs + REVIEW_TTL_MS;
        pairingReviews.set(reviewId, Object.freeze({ requirement, snapshot, expiresAtMs }));
        safeSink(onAudit, {
          action: "gateway-pairing",
          outcome: "reviewed",
          reason: snapshot.reason,
          roleCount: snapshot.requested.roles.length,
          scopeCount: snapshot.requested.scopes.length
        });
        return Object.freeze({
          schemaVersion: 1,
          reviewId,
          requestId: snapshot.requestId,
          deviceId: snapshot.deviceId,
          reason: snapshot.reason,
          requested: snapshot.requested,
          approved: snapshot.approved,
          expiresAt: new Date(expiresAtMs).toISOString()
        });
      },
      approve(reviewId) { return decidePairing(reviewId, "approved"); },
      reject(reviewId) { return decidePairing(reviewId, "rejected"); }
    }),
    async stop({ timeoutMs = 15_000 } = {}) {
      if (state === "starting") await inFlight;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 60_000) {
        throw new TypeError("Gateway stop timeout is invalid");
      }
      if ((state !== "ready" && state !== "failed") || !active) {
        return Object.freeze({
          complete: false,
          mode: "guest-supervisor",
          reason: "OpenClaw Gateway is not running",
          taskId: lastTask?.id ?? null,
          durationMs: 0
        });
      }
      state = "stopping";
      const startedAt = now();
      let stopped;
      try {
        stopped = await active.stop({ timeoutMs });
      } catch (error) {
        authToken = undefined;
        state = "failed";
        safeSink(onAudit, {
          action: "gateway",
          outcome: "stop_failed",
          port: gatewayPort,
          taskId: lastTask?.id,
          reason: error instanceof BrowserRuntimeError ? error.code : "stop_failed"
        });
        throw error;
      }
      const result = Object.freeze({ ...stopped, durationMs: Math.max(0, now() - startedAt) });
      authToken = undefined;
      active = undefined;
      readyResult = undefined;
      pairingReviews.clear();
      state = result.complete ? "stopped" : "failed";
      safeSink(onAudit, {
        action: "gateway",
        outcome: result.complete ? "stopped" : "stop_failed",
        port: gatewayPort,
        taskId: result.taskId,
        durationMs: result.durationMs
      });
      return result;
    }
  };
  Object.defineProperty(gateway, "task", {
    enumerable: false,
    get() { return lastTask; }
  });
  return Object.freeze(gateway);
}
