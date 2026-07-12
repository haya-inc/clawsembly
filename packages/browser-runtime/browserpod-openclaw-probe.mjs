import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { startCooperativeProcess } from "./cooperative-process.mjs";
import { runBrowserRuntimePreflight } from "./browserpod-preflight.mjs";
import { createBrowserPodRuntime } from "./browserpod-runtime.mjs";
import {
  assertExactOpenClawArtifact,
  createVerifiedOpenClawInstaller
} from "./openclaw-installer.mjs";

export const BROWSERPOD_HEALTH_PREFIX = "[clawsembly-browserpod-health]";
const PROBE_ROOT = "/workspace/clawsembly-probe";

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

function validateProbeOptions({ browser, source, port, gatewayToken, now }) {
  if (typeof browser !== "string" || browser.trim().length === 0 || browser.length > 512) {
    throw new TypeError("a measured browser identifier is required");
  }
  if (typeof source !== "string" || source.trim().length === 0 || source.length > 512) {
    throw new TypeError("a BrowserPod evidence source is required");
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("the BrowserPod Gateway port is invalid");
  }
  if (typeof gatewayToken !== "string" || gatewayToken.length < 16 || gatewayToken.length > 512
    || gatewayToken.includes("\0")) {
    throw new TypeError("an ephemeral Gateway token of at least 16 characters is required");
  }
  if (typeof now !== "function") throw new TypeError("the BrowserPod probe clock is invalid");
}

function parseJson(text, label) {
  try { return JSON.parse(text); }
  catch { throw new BrowserRuntimeError("invalid_evidence", `${label} is not valid JSON`); }
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

function runtimeLimitations(features) {
  return Object.freeze([
    ...features.interactiveInput ? [] : ["interactive-input-unavailable"],
    ...features.processTermination ? [] : ["provider-process-termination-unavailable"],
    ...features.hardDispose ? [] : ["hard-dispose-unavailable"],
    ...(features.portalVisibility === "public-url" ? ["portal-is-public-url"] : [])
  ]);
}

function relayOutput(onOutput, phase, chunk) {
  try { onOutput(Object.freeze({ phase, chunk })); }
  catch { /* Diagnostic consumers cannot break the evidence probe. */ }
}

/**
 * Boots one metered BrowserPod, installs the exact npm artifact, and proves the
 * first Gateway readiness boundary, then stops the Gateway through a guest
 * supervisor. Provider process termination and hard Pod disposal remain
 * unavailable and are reported separately.
 */
export async function runBrowserPodOpenClawProbe({
  BrowserPod,
  apiKey,
  artifact: untrustedArtifact,
  browser,
  source = "owner-authorized BrowserPod OpenClaw readiness probe",
  storageKey,
  port = 18_789,
  gatewayToken = `clawsembly-${globalThis.crypto.randomUUID()}`,
  supervisorNonceFactory,
  onOutput = () => {},
  now = Date.now
}) {
  const artifact = assertExactOpenClawArtifact(untrustedArtifact);
  validateProbeOptions({ browser, source, port, gatewayToken, now });
  const runtime = await createBrowserPodRuntime({ BrowserPod, apiKey, storageKey });
  const preflight = await runBrowserRuntimePreflight({
    runtime,
    onOutput: (chunk) => relayOutput(onOutput, "preflight", chunk)
  });
  if (!preflight.checks.cryptoVerify || !preflight.checks.sqlite) {
    throw new BrowserRuntimeError("preflight_failed", "BrowserPod crypto and SQLite checks must pass");
  }

  const installer = createVerifiedOpenClawInstaller({
    runtime,
    artifact,
    root: PROBE_ROOT,
    onOutput: ({ chunk }) => relayOutput(onOutput, "install", chunk),
    now
  });
  const installed = await installer.install();

  const gatewayStartedAt = now();
  const supervisedGateway = await startCooperativeProcess({
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
        String(port),
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
    },
    ...(supervisorNonceFactory ? { nonceFactory: supervisorNonceFactory } : {})
  });
  const gatewayTask = supervisedGateway.task;
  gatewayTask.onOutput((chunk) => relayOutput(onOutput, "gateway", chunk));
  const readinessController = new AbortController();
  const readiness = Promise.all([
    runtime.waitForPortal(port, { timeoutMs: 60_000, signal: readinessController.signal }),
    gatewayTask.waitForOutput("[gateway] ready", { timeoutMs: 60_000, signal: readinessController.signal })
  ]).then(([portal]) => ({ kind: "ready", portal }));
  let gatewayOutcome;
  try {
    gatewayOutcome = await Promise.race([
      readiness,
      gatewayTask.wait().then((completion) => ({ kind: "exit", completion }))
    ]);
  } catch (error) {
    readinessController.abort();
    throw error;
  }
  if (gatewayOutcome.kind === "exit") {
    readinessController.abort();
    throw new BrowserRuntimeError(
      "gateway_exited",
      `OpenClaw Gateway exited before BrowserPod readiness (${gatewayOutcome.completion.status})`
    );
  }
  const portal = gatewayOutcome.portal;

  const healthTask = await runtime.start({
    executable: "node",
    args: ["--input-type=module", "-e", BROWSERPOD_HEALTH_SOURCE, String(port)],
    cwd: installed.root,
    env: ["NO_COLOR=1"],
    outputLimitBytes: 64 * 1024
  });
  healthTask.onOutput((chunk) => relayOutput(onOutput, "health", chunk));
  const healthCompletion = await healthTask.wait();
  if (healthCompletion.status !== "completed") {
    throw new BrowserRuntimeError("health_probe_failed", "BrowserPod Gateway health probe failed");
  }
  const health = parseBrowserPodHealthEvidence(healthTask.transcript);
  const gatewayDurationMs = Math.max(0, now() - gatewayStartedAt);
  const terminationStartedAt = now();
  const termination = await supervisedGateway.stop({ timeoutMs: 15_000 });
  const terminationDurationMs = Math.max(0, now() - terminationStartedAt);
  if (!termination.complete) {
    throw new BrowserRuntimeError("cooperative_stop_failed", "BrowserPod Gateway cooperative stop did not complete");
  }

  const evidence = Object.freeze({
    schemaVersion: 1,
    capturedAt: new Date(now()).toISOString(),
    source,
    target: Object.freeze({
      runtime: "browserpod",
      runtimeVersion: runtime.version,
      browser,
      browserLocal: true
    }),
    artifact,
    preflight: Object.freeze({
      node: preflight.node,
      platform: preflight.platform,
      arch: preflight.arch,
      checks: preflight.checks,
      lifecycle: preflight.lifecycle
    }),
    install: Object.freeze({
      result: "pass",
      command: "npm install --save-exact openclaw@<version>",
      durationMs: installed.durationMs,
      installedVersion: installed.artifact.version,
      lockIntegrity: installed.artifact.integrity,
      integrityMatched: true,
      outputTruncated: installed.outputTruncated
    }),
    gateway: Object.freeze({
      result: "pass",
      port,
      bind: "loopback",
      auth: "token",
      taskId: gatewayTask.id,
      durationMs: gatewayDurationMs,
      readiness: Object.freeze({ output: true, portal: true, healthz: true, readyz: true }),
      portal,
      healthz: Object.freeze(health.healthz),
      readyz: Object.freeze(health.readyz),
      termination: Object.freeze({
        mode: "guest-supervisor",
        result: "pass",
        durationMs: terminationDurationMs,
        providerProcessTermination: false,
        hardDispose: false
      }),
      outputTruncated: gatewayTask.outputTruncated
    }),
    limitations: runtimeLimitations(runtime.features)
  });

  return Object.freeze({
    evidence,
    runtime,
    gatewayTask,
    dispose() { return runtime.dispose(); }
  });
}
