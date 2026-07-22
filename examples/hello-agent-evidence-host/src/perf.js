import { BrowserPod } from "@leaningtech/browserpod";
import {
  bootHelloAgentEmbed
} from "../../../packages/hello-agent-binding/hello-agent-binding.mjs";
import {
  assertHelloAgentPerfSample
} from "../../../packages/hello-agent-binding/hello-agent-perf.mjs";
import { bootstrapManifest } from "./bootstrap-manifest.js";

const status = document.querySelector("[data-capture-status]");
globalThis.__CLAWSEMBLY_FAILURE_CODE__ = null;

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const PASS_KINDS = new Set(["cold", "warm", "persistentReuse"]);

async function storageUsage() {
  try {
    const estimate = await navigator.storage?.estimate?.();
    return Number.isFinite(estimate?.usage) ? estimate.usage : null;
  } catch {
    return null;
  }
}

/**
 * Runs exactly one metered boot of the hello-agent chain and measures the
 * documented phases on the unmodified production path: bootHelloAgentEmbed,
 * digest-verified staging, process readiness, one hello.say round trip, and
 * cooperative close. Pass placement (fresh context, reloaded page, reused
 * workspace) is the driver's job; this page only reports what one boot cost.
 */
globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_PERF_PASS__ = async (options) => {
  const apiKey = options?.apiKey;
  const passKind = options?.passKind;
  const workspaceId = options?.workspaceId;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("Owner-authorized hello-agent perf options are incomplete.");
  }
  if (!PASS_KINDS.has(passKind) || typeof workspaceId !== "string"
    || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("hello-agent perf pass kind or workspace identifier is invalid.");
  }
  options.apiKey = undefined;
  status.textContent = `Measuring one ${passKind} hello-agent boot.`;

  let session;
  try {
    const manifest = await bootstrapManifest();
    const beforeUsageBytes = await storageUsage();

    let providerBootMs = null;
    const bootStarted = performance.now();
    session = await bootHelloAgentEmbed({
      manifest,
      BrowserPod,
      browserPodApiKey: apiKey,
      workspaceId,
      sessionId: `perf-${passKind}`,
      onRuntimeAudit: (event) => {
        if (event?.action === "boot" && Number.isFinite(event?.durationMs)) {
          providerBootMs = event.durationMs;
        }
      },
      processOptions: { readyTimeoutMs: 60_000, pollIntervalMs: 100 }
    });
    const bootMs = performance.now() - bootStarted;

    status.textContent = "Staging the digest-verified artifact.";
    const installed = await session.installer.install();

    status.textContent = "Waiting for both readiness signals.";
    const readyStarted = performance.now();
    await session.process.start();
    const readyMs = performance.now() - readyStarted;

    status.textContent = "Driving the first protocol round trip.";
    const client = session.createClient({ timeoutMs: 60_000, pollIntervalMs: 150 });
    const helloStarted = performance.now();
    const greeting = await client.say({ name: "Clawsembly" });
    const helloRoundTripMs = performance.now() - helloStarted;
    if (greeting.greeting !== "Hello, Clawsembly!") {
      throw new Error("hello-agent greeting did not match the fixture contract");
    }

    status.textContent = "Stopping the guest through the cooperative supervisor.";
    const closeStarted = performance.now();
    const closed = await session.close();
    const closeMs = performance.now() - closeStarted;
    if (closed.gatewayStop.complete !== true) {
      throw new Error("cooperative guest shutdown did not complete");
    }
    const afterUsageBytes = await storageUsage();

    const sample = {
      schemaVersion: 1,
      passKind,
      workspaceId,
      phases: {
        bootMs,
        providerBootMs: providerBootMs ?? bootMs,
        installMs: installed.durationMs,
        readyMs,
        helloRoundTripMs,
        closeMs
      },
      install: {
        integrityMatched: installed.integrityMatched,
        fileCount: installed.fileCount,
        stagedBytes: installed.files.reduce((total, file) => total + file.bytes, 0)
      },
      storage: { beforeUsageBytes, afterUsageBytes }
    };
    assertHelloAgentPerfSample(sample);
    status.textContent = `Measured one ${passKind} boot; guest cooperatively stopped.`;
    return {
      sample,
      runtimeVersion: session.runtime.version,
      browser: navigator.userAgent
    };
  } catch (error) {
    globalThis.__CLAWSEMBLY_FAILURE_CODE__ = typeof error?.code === "string"
      && /^[a-z0-9_-]{1,64}$/u.test(error.code)
      ? error.code
      : null;
    throw error;
  } finally {
    if (session && !session.closed) {
      try { await session.close(); }
      catch { /* The payload-free status artifact reports the primary failure. */ }
    }
  }
};
