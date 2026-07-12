import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { startCooperativeProcess } from "./cooperative-process.mjs";

export const OPENCLAW_GATEWAY_PORT = 18_789;
export const BROWSERPOD_HEALTH_PREFIX = "[clawsembly-browserpod-health]";

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

export function createVerifiedOpenClawGateway({
  runtime,
  installer,
  port = OPENCLAW_GATEWAY_PORT,
  allowedOrigins = [],
  tokenFactory = () => `clawsembly-${globalThis.crypto.randomUUID()}`,
  supervisorNonceFactory,
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
  if (onOutput !== undefined && typeof onOutput !== "function") throw new TypeError("Gateway output sink is invalid");
  if (onAudit !== undefined && typeof onAudit !== "function") throw new TypeError("Gateway audit sink is invalid");
  if (typeof now !== "function") throw new TypeError("Gateway clock is invalid");

  let state = "idle";
  let inFlight;
  let active;
  let readyResult;
  let authToken;
  let lastTask;

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
