// Native-Gateway evidence capture (ADR 0006, wrap deliverable 1): install the
// exact pinned OpenClaw artifact on plain Node, boot the real Gateway on
// loopback, probe health and readiness, run the generated protocol client
// against it (handshake, bounded chat, abort, history, device-token
// reconnect), and write one digest-bound record of the separate
// "native-gateway" evidence class. No BrowserPod, no API key, no metered
// spend: the lane carries no model-provider credential, so the chat run is
// expected to terminate at the provider boundary and the record keeps
// statuses, enums, counts, and durations only. The record never satisfies,
// implies, or promotes BrowserPod runtime support, and the status file
// stays payload-free.
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createVerifiedOpenClawInstaller } from "../../packages/browser-runtime/openclaw-installer.mjs";
import {
  assertNativeGatewayEvidence,
  buildNativeGatewayEvidence,
  probeNativeGatewayHealth,
  startNativeOpenClawGateway
} from "../../packages/compatibility/src/native-gateway-capture.mjs";
import {
  createLoopbackControlUiWebSocketFactory,
  exerciseNativeGatewayProtocol
} from "../../packages/compatibility/src/native-gateway-protocol.mjs";
import { createNativeNodeRuntime } from "../../packages/compatibility/src/native-node-runtime.mjs";
import {
  NodeEngineRangeError,
  assertNodeEngineSatisfied
} from "../../packages/compatibility/src/node-engine-range.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const outputRoot = resolve(repoRoot, "test-results", "native-gateway-evidence");
const startedAt = Date.now();

function log(message) {
  console.log(`[native-capture] ${message}`);
}

async function writeStatus(status) {
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    join(outputRoot, "capture-status.json"),
    `${JSON.stringify({ ...status, durationMs: Date.now() - startedAt }, null, 2)}\n`,
    "utf8"
  );
}

function loadReportIdentity(report) {
  const artifact = report?.artifact;
  if (artifact?.package !== "openclaw" || typeof artifact?.version !== "string"
    || typeof artifact?.integrity !== "string" || typeof artifact?.nodeEngine !== "string") {
    throw new Error("the pinned report does not carry an exact OpenClaw artifact identity");
  }
  return {
    artifact: { package: "openclaw", version: artifact.version, integrity: artifact.integrity },
    nodeEngine: artifact.nodeEngine
  };
}

async function main() {
  const reportRelative = process.env.CLAWSEMBLY_EVIDENCE_REPORT ?? "apps/web/public/data/compatibility.json";
  const dataRoot = resolve(repoRoot, "apps", "web", "public", "data");
  const reportPath = resolve(repoRoot, reportRelative);
  if (reportPath !== dataRoot && !reportPath.startsWith(`${dataRoot}${sep}`)) {
    throw new Error("the evidence report must live under apps/web/public/data");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const { artifact, nodeEngine } = loadReportIdentity(report);
  log(`target openclaw@${artifact.version}, engines "${nodeEngine}"`);

  assertNodeEngineSatisfied(process.versions.node, nodeEngine);
  log(`local Node ${process.versions.node} satisfies the declared range`);

  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-native-evidence-"));
  const runtime = createNativeNodeRuntime({ hostRoot });
  try {
    const installer = createVerifiedOpenClawInstaller({
      runtime,
      artifact,
      root: "/native/openclaw"
    });
    log("installing the exact artifact via npm (this downloads the real dependency tree)");
    const installed = await installer.install();
    log(`install verified against SHA-512 in ${installed.durationMs}ms`);

    const port = Number(process.env.CLAWSEMBLY_NATIVE_GATEWAY_PORT ?? 18_789);
    const token = randomBytes(24).toString("base64url");
    const gateway = await startNativeOpenClawGateway({ runtime, installed, port, token });
    log(`Gateway ready on loopback:${port} after ${gateway.readyDurationMs}ms`);
    const health = await probeNativeGatewayHealth(port);
    log("healthz and readyz both returned 200");
    log("exercising the generated protocol client (handshake, chat, abort, history, reconnect)");
    const protocol = await exerciseNativeGatewayProtocol({
      artifact,
      port,
      token,
      createWebSocket: createLoopbackControlUiWebSocketFactory({ port })
    });
    log(`handshake ok in ${protocol.handshake.durationMs}ms `
      + `(${protocol.handshake.methodCount} methods, device token issued)`);
    log(`chat round trip: send "${protocol.chat.sendStatus}", terminal "${protocol.chat.terminalState}" `
      + `after ${protocol.chat.eventCount} event(s) with no provider credential`);
    log(`abort acknowledged (aborted: ${protocol.abort.aborted}), `
      + `history returned ${protocol.history.messageCount} message(s)`);
    log(`reconnect authenticated with the vaulted device token in ${protocol.reconnect.durationMs}ms`);
    const termination = await gateway.stop();
    log(`Gateway stopped (${termination.graceful ? "graceful" : "forced"})`);

    const evidence = buildNativeGatewayEvidence({
      artifact,
      nodeEngine,
      install: installed,
      gateway: { port, readyDurationMs: gateway.readyDurationMs },
      health,
      termination,
      protocol,
      capturedAt: new Date().toISOString()
    });
    assertNativeGatewayEvidence(evidence, { artifact });
    await mkdir(outputRoot, { recursive: true });
    const evidencePath = join(outputRoot, `native-gateway-openclaw-${artifact.version}.json`);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await writeStatus({
      status: "captured",
      class: evidence.class,
      artifact: { package: artifact.package, version: artifact.version },
      nodeVersion: process.versions.node,
      digest: evidence.digest
    });
    log("native-gateway evidence captured and digest-bound");
  } finally {
    await runtime.close();
    await rm(hostRoot, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(async (error) => {
  const reason = error instanceof NodeEngineRangeError || typeof error?.code === "string"
    ? error.code
    : "capture_failed";
  console.error(`[native-capture] failed: ${reason}`);
  await writeStatus({ status: "failed", reason, nodeVersion: process.versions.node }).catch(() => {});
  process.exitCode = 1;
});
