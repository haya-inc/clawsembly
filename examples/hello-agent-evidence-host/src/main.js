import { BrowserPod } from "@leaningtech/browserpod";
import { HELLO_AGENT_ARTIFACT } from "../../../packages/hello-agent-binding/hello-agent-artifact.generated.mjs";
import {
  assertHelloAgentRuntimeEvidence,
  bootHelloAgentEmbed,
  helloAgentEvidenceRecord
} from "../../../packages/hello-agent-binding/hello-agent-binding.mjs";
import { HELLO_AGENT_IDENTITY as IDENTITY, bootstrapManifest } from "./bootstrap-manifest.js";

const status = document.querySelector("[data-capture-status]");
const encoder = new TextEncoder();
globalThis.__CLAWSEMBLY_PHASE_COUNTS__ = Object.create(null);
globalThis.__CLAWSEMBLY_FAILURE_CODE__ = null;

function countPhase(phase, chunk) {
  const current = globalThis.__CLAWSEMBLY_PHASE_COUNTS__[phase] ?? { chunks: 0, bytes: 0 };
  globalThis.__CLAWSEMBLY_PHASE_COUNTS__[phase] = {
    chunks: current.chunks + 1,
    bytes: current.bytes + encoder.encode(String(chunk)).byteLength
  };
}

function expectCode(code) {
  return (error) => {
    if (error?.code !== code) {
      throw new Error(`expected a ${code} rejection, saw ${error?.code ?? error}`);
    }
    return true;
  };
}

globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_EVIDENCE__ = async (options) => {
  const apiKey = options?.apiKey;
  if (typeof apiKey !== "string" || !apiKey) {
    throw new Error("Owner-authorized hello-agent capture options are incomplete.");
  }
  options.apiKey = undefined;
  status.textContent = "Owner-authorized hello-agent evidence capture is running.";

  let session;
  let pump;
  let serving;
  try {
    const manifest = await bootstrapManifest();

    let releaseBlockedTurn;
    const blockedTurnStarted = new Promise((resolve) => { releaseBlockedTurn = resolve; });
    session = await bootHelloAgentEmbed({
      manifest,
      BrowserPod,
      browserPodApiKey: apiKey,
      workspaceId: "evidence",
      sessionId: "hello-evidence",
      capabilityHandlers: {
        // The embedder-supplied capability handler stays deterministic and
        // provider-free: the record proves the boundary crossing, not any
        // model output.
        "chat.complete": (input, { signal }) => {
          if (input.message === "block until aborted") {
            releaseBlockedTurn();
            return new Promise((resolvePromise, reject) => {
              signal.addEventListener("abort", () => reject(new Error("cancelled by host")), { once: true });
            });
          }
          return { reply: `echo: ${input.message}` };
        }
      },
      onRuntimeAudit: (event) => countPhase(`runtime:${event.action}`, event.outcome ?? ""),
      onProcessOutput: ({ phase, chunk }) => countPhase(phase, chunk),
      processOptions: { readyTimeoutMs: 60_000, pollIntervalMs: 100 }
    });

    pump = new AbortController();
    serving = session.mailbox.serve({ signal: pump.signal }).catch(() => {});

    status.textContent = "Starting the staged hello-agent guest.";
    const readiness = await session.process.start();
    const client = session.createClient({ timeoutMs: 60_000, pollIntervalMs: 150 });

    status.textContent = "Driving protocol round trips across the boundary.";
    const greeting = await client.say({ name: "Clawsembly" });
    if (greeting.greeting !== "Hello, Clawsembly!") {
      throw new Error("hello-agent greeting did not match the fixture contract");
    }

    const beforeApproval = await client.startChat({ message: "before approval" });
    await beforeApproval.completion.then(
      () => { throw new Error("chat must fail closed before approval"); },
      expectCode("capability_denied")
    );

    session.permissions.approve("chat.complete", "provider:reference", {
      durationMs: 10 * 60 * 1_000,
      maxCalls: 16
    });
    const turn = await client.startChat({ message: "Say hello to the boundary" });
    const completed = await turn.completion;
    if (completed.reason !== "completed" || completed.reply !== "echo: Say hello to the boundary") {
      throw new Error("capability-mediated chat turn did not complete as expected");
    }

    const blocked = await client.startChat({ message: "block until aborted" });
    await blockedTurnStarted;
    const abortAck = await client.abortChat({ target: blocked.id });
    if (abortAck.aborted !== true) throw new Error("in-flight abort was not acknowledged");
    const abortedTurn = await blocked.completion;
    if (abortedTurn.reason !== "aborted" || abortedTurn.reply !== null) {
      throw new Error("aborted chat turn did not settle as aborted");
    }

    session.permissions.revoke("chat.complete", "provider:reference");
    const afterRevoke = await client.startChat({ message: "after revoke" });
    await afterRevoke.completion.then(
      () => { throw new Error("chat must fail closed after revocation"); },
      expectCode("capability_denied")
    );

    const historyView = await client.chatHistory();
    const reasons = historyView.turns.map((turn2) => turn2.reason).join(",");
    if (reasons !== "capability_denied,completed,aborted,capability_denied") {
      throw new Error(`hello-agent history did not record the expected outcomes: ${reasons}`);
    }

    const installed = await session.installer.install();
    status.textContent = "Stopping the guest through the cooperative supervisor.";
    const closed = await session.close();
    if (closed.gatewayStop.complete !== true) {
      throw new Error("cooperative guest shutdown did not complete");
    }

    const brokerRequests = session.capabilities.auditSnapshot().events
      .filter((event) => event.action === "request" && event.capability === "chat.complete");
    const denied = brokerRequests.filter((event) => event.outcome === "denied").length;
    const allowed = brokerRequests.filter((event) => event.outcome === "allowed").length;

    const evidence = {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      target: {
        runtime: "browserpod",
        browserLocal: true,
        runtimeVersion: session.runtime.version,
        browser: navigator.userAgent
      },
      artifact: { ...IDENTITY },
      install: {
        result: "pass",
        integrityMatched: installed.integrityMatched,
        fileCount: installed.fileCount,
        durationMs: installed.durationMs
      },
      process: {
        result: "pass",
        readiness,
        termination: {
          mode: closed.gatewayStop.mode,
          result: closed.gatewayStop.complete ? "pass" : "fail"
        }
      },
      protocol: {
        methods: [...HELLO_AGENT_ARTIFACT.methods],
        helloRoundTrips: 1,
        chatRoundTrips: historyView.total
      },
      capability: {
        capability: "chat.complete",
        scope: "provider:reference",
        denied,
        allowed
      }
    };
    assertHelloAgentRuntimeEvidence(evidence);
    const record = await helloAgentEvidenceRecord(evidence);
    status.textContent = "Evidence captured and guest cooperatively stopped.";
    return { evidence, record };
  } catch (error) {
    globalThis.__CLAWSEMBLY_FAILURE_CODE__ = typeof error?.code === "string"
      && /^[a-z0-9_-]{1,64}$/u.test(error.code)
      ? error.code
      : null;
    throw error;
  } finally {
    pump?.abort();
    await serving;
    if (session && !session.closed) {
      try { await session.close(); }
      catch { /* The payload-free status artifact reports the primary failure. */ }
    }
  }
};
