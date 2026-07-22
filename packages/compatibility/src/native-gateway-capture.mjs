// Native-Gateway evidence lane (ADR 0006, decision 1.i): boot the exact
// verified OpenClaw artifact on plain Node, observe readiness, and build a
// digest-bound record of the separate "native-gateway" evidence class. This
// class never satisfies, implies, or promotes BrowserPod runtime support:
// the record names runtime "native-node" with browserLocal:false and is not
// consumed by the report pipeline or the verified-launch gates.

import { createHash } from "node:crypto";

import { BrowserRuntimeError } from "../../browser-runtime/browser-runtime.mjs";
import {
  assertOpenClawGatewayPort,
  assertOpenClawGatewayToken
} from "../../browser-runtime/openclaw-gateway.mjs";

export const NATIVE_GATEWAY_EVIDENCE_CLASS = "native-gateway";
export const NATIVE_GATEWAY_READY_LINE = "[gateway] ready";
const HEALTH_ENDPOINTS = ["healthz", "readyz"];

/**
 * Starts the installed OpenClaw Gateway as a direct native child process.
 * The command and environment mirror the browser lane's supervised recipe in
 * openclaw-gateway.mjs; supervision itself is not reused because the
 * cooperative supervisor is BrowserPod-scoped, so shutdown is signal-based
 * (`stop()` sends SIGTERM, then SIGKILL after the grace period).
 */
export async function startNativeOpenClawGateway({
  runtime,
  installed,
  port,
  token,
  onOutput,
  now = Date.now
} = {}) {
  if (!runtime || runtime.provider !== "native-node" || typeof runtime.start !== "function") {
    throw new TypeError("a native-node runtime is required for the native Gateway lane");
  }
  if (!installed || installed.integrityMatched !== true || typeof installed.executablePath !== "string"
    || typeof installed.root !== "string" || typeof installed.stateRoot !== "string") {
    throw new TypeError("a verified OpenClaw install result is required");
  }
  const gatewayPort = assertOpenClawGatewayPort(port);
  const gatewayToken = assertOpenClawGatewayToken(token);
  if (typeof onOutput !== "undefined" && typeof onOutput !== "function") {
    throw new TypeError("the native Gateway output sink is invalid");
  }
  if (typeof now !== "function") throw new TypeError("the native Gateway clock is invalid");

  const startedAt = now();
  const task = await runtime.start({
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
      `OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`
    ],
    outputLimitBytes: 2 * 1024 * 1024
  });
  if (onOutput) task.onOutput((chunk) => onOutput({ phase: "gateway", chunk }));

  const readinessController = new AbortController();
  let outcome;
  try {
    outcome = await Promise.race([
      task.waitForOutput(NATIVE_GATEWAY_READY_LINE, { timeoutMs: 60_000, signal: readinessController.signal })
        .then(() => ({ kind: "ready" })),
      task.wait().then((completion) => ({ kind: "exit", completion }))
    ]);
  } finally {
    readinessController.abort();
  }
  if (outcome.kind === "exit") {
    throw new BrowserRuntimeError(
      "gateway_exited",
      `the OpenClaw Gateway exited before readiness (${outcome.completion.status})`
    );
  }
  const readyDurationMs = Math.max(0, now() - startedAt);

  return Object.freeze({
    task,
    port: gatewayPort,
    readyDurationMs,
    async stop({ graceMs = 5_000 } = {}) {
      if (!Number.isSafeInteger(graceMs) || graceMs < 0 || graceMs > 60_000) {
        throw new TypeError("the Gateway stop grace period is invalid");
      }
      task.terminate("SIGTERM");
      let graceful = true;
      let timer;
      await Promise.race([
        task.wait(),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            graceful = false;
            task.terminate("SIGKILL");
            resolve(undefined);
          }, graceMs);
        })
      ]);
      clearTimeout(timer);
      await task.wait();
      return Object.freeze({ mode: "signal", graceful });
    }
  });
}

/**
 * Probes the loopback Gateway health endpoints from the host process. Bodies
 * are read to confirm the response completes but are never retained: the
 * native evidence record stays payload-free.
 */
export async function probeNativeGatewayHealth(port, {
  fetchImplementation = fetch,
  attempts = 60,
  delayMs = 500
} = {}) {
  const gatewayPort = assertOpenClawGatewayPort(port);
  const result = {};
  for (const endpoint of HEALTH_ENDPOINTS) {
    let lastError = "not ready";
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchImplementation(`http://127.0.0.1:${gatewayPort}/${endpoint}`);
        await response.text();
        if (response.status === 200) {
          result[endpoint] = Object.freeze({ status: 200 });
          break;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (!result[endpoint]) {
      throw new BrowserRuntimeError("health_probe_failed", `the Gateway ${endpoint} probe failed: ${lastError}`);
    }
  }
  return Object.freeze(result);
}

function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalizeValue(entry));
  if (value && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalizeValue(value[key]);
    return sorted;
  }
  return value;
}

export function canonicalizeNativeGatewayEvidence(record) {
  return JSON.stringify(canonicalizeValue(record));
}

function digestOf(record) {
  return createHash("sha256").update(canonicalizeNativeGatewayEvidence(record), "utf8").digest("hex");
}

/**
 * Builds the digest-bound native-gateway evidence record. Payload-free by
 * construction: it carries statuses, durations, and identity only — no
 * transcript text, bodies, environment values, or host paths.
 */
export function buildNativeGatewayEvidence({
  artifact,
  nodeEngine,
  install,
  gateway,
  health,
  termination,
  capturedAt
}) {
  if (!artifact || artifact.package !== "openclaw" || typeof artifact.version !== "string"
    || typeof artifact.integrity !== "string") {
    throw new TypeError("an exact OpenClaw artifact identity is required");
  }
  if (typeof nodeEngine !== "string" || nodeEngine.length === 0) {
    throw new TypeError("the artifact Node engines declaration is required");
  }
  if (!install || install.integrityMatched !== true || !Number.isSafeInteger(install.durationMs)) {
    throw new TypeError("a verified install result is required");
  }
  if (!gateway || !Number.isSafeInteger(gateway.port) || !Number.isSafeInteger(gateway.readyDurationMs)) {
    throw new TypeError("a ready native Gateway result is required");
  }
  if (health?.healthz?.status !== 200 || health?.readyz?.status !== 200) {
    throw new TypeError("passing health and readiness probes are required");
  }
  if (!termination || termination.mode !== "signal" || typeof termination.graceful !== "boolean") {
    throw new TypeError("a signal-mode termination result is required");
  }
  if (typeof capturedAt !== "string" || Number.isNaN(Date.parse(capturedAt))) {
    throw new TypeError("a capture timestamp is required");
  }
  const record = {
    schemaVersion: 1,
    class: NATIVE_GATEWAY_EVIDENCE_CLASS,
    target: {
      package: "openclaw",
      version: artifact.version,
      integrity: artifact.integrity,
      runtime: "native-node",
      browserLocal: false
    },
    host: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch
    },
    engines: { declared: nodeEngine, satisfiedBy: process.versions.node },
    install: {
      durationMs: install.durationMs,
      outputTruncated: install.outputTruncated === true,
      integrityMatched: true
    },
    gateway: {
      port: gateway.port,
      bind: "loopback",
      auth: "token",
      readyLine: NATIVE_GATEWAY_READY_LINE,
      readyDurationMs: gateway.readyDurationMs,
      healthz: { status: 200 },
      readyz: { status: 200 },
      termination: { mode: "signal", graceful: termination.graceful }
    },
    capturedAt
  };
  return Object.freeze({ ...record, digest: digestOf(record) });
}

/**
 * Fail-closed acceptance for one native-gateway record: exact class, runtime,
 * and artifact identity plus a matching recomputed digest. This assertion is
 * the only admission path for the class and is deliberately disjoint from
 * assertBrowserRuntimeEvidence — a native record can never be presented as
 * BrowserPod runtime evidence, and vice versa.
 */
export function assertNativeGatewayEvidence(evidence, { artifact } = {}) {
  if (!evidence || typeof evidence !== "object") {
    throw new BrowserRuntimeError("invalid_native_evidence", "a native-gateway evidence record is required");
  }
  const { digest, ...record } = evidence;
  if (evidence.schemaVersion !== 1 || evidence.class !== NATIVE_GATEWAY_EVIDENCE_CLASS
    || evidence.target?.runtime !== "native-node" || evidence.target?.browserLocal !== false
    || evidence.target?.package !== "openclaw") {
    throw new BrowserRuntimeError("invalid_native_evidence", "the record is not native-gateway class evidence");
  }
  if (artifact && (evidence.target.version !== artifact.version
    || evidence.target.integrity !== artifact.integrity)) {
    throw new BrowserRuntimeError("invalid_native_evidence", "the record does not match the expected artifact");
  }
  if (evidence.gateway?.healthz?.status !== 200 || evidence.gateway?.readyz?.status !== 200
    || evidence.gateway?.readyLine !== NATIVE_GATEWAY_READY_LINE) {
    throw new BrowserRuntimeError("invalid_native_evidence", "the record does not prove Gateway readiness");
  }
  if (typeof digest !== "string" || digest !== digestOf(record)) {
    throw new BrowserRuntimeError("invalid_native_evidence", "the record digest does not match its content");
  }
  return evidence;
}
