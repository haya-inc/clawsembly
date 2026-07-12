import { BrowserRuntimeError } from "./browser-runtime.mjs";
import { runBrowserRuntimePreflight } from "./browserpod-preflight.mjs";
import { createBrowserPodRuntime } from "./browserpod-runtime.mjs";
import {
  assertExactOpenClawArtifact,
  createVerifiedOpenClawInstaller
} from "./openclaw-installer.mjs";
import {
  assertOpenClawGatewayPort,
  assertOpenClawGatewayToken,
  createVerifiedOpenClawGateway,
  OPENCLAW_GATEWAY_PORT
} from "./openclaw-gateway.mjs";

export {
  BROWSERPOD_HEALTH_PREFIX,
  BROWSERPOD_HEALTH_SOURCE,
  parseBrowserPodHealthEvidence
} from "./openclaw-gateway.mjs";

const PROBE_ROOT = "/workspace/clawsembly-probe";

function validateProbeOptions({ browser, source, port, gatewayToken, now }) {
  if (typeof browser !== "string" || browser.trim().length === 0 || browser.length > 512) {
    throw new TypeError("a measured browser identifier is required");
  }
  if (typeof source !== "string" || source.trim().length === 0 || source.length > 512) {
    throw new TypeError("a BrowserPod evidence source is required");
  }
  assertOpenClawGatewayPort(port);
  assertOpenClawGatewayToken(gatewayToken);
  if (typeof now !== "function") throw new TypeError("the BrowserPod probe clock is invalid");
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
  port = OPENCLAW_GATEWAY_PORT,
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
  const gateway = createVerifiedOpenClawGateway({
    runtime,
    installer,
    port,
    tokenFactory: () => gatewayToken,
    ...(supervisorNonceFactory ? { supervisorNonceFactory } : {}),
    onOutput: (event) => relayOutput(onOutput, event.phase, event.chunk),
    now
  });
  const gatewayReady = await gateway.start();
  const installed = await installer.install();
  const gatewayTask = gateway.task;
  const termination = await gateway.stop({ timeoutMs: 15_000 });
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
      taskId: gatewayReady.taskId,
      durationMs: gatewayReady.durationMs,
      readiness: Object.freeze({ output: true, portal: true, healthz: true, readyz: true }),
      portal: gatewayReady.portal,
      healthz: gatewayReady.healthz,
      readyz: gatewayReady.readyz,
      termination: Object.freeze({
        mode: "guest-supervisor",
        result: "pass",
        durationMs: termination.durationMs,
        providerProcessTermination: false,
        hardDispose: false
      }),
      outputTruncated: gatewayReady.outputTruncated
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
