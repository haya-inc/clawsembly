import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  NATIVE_GATEWAY_EVIDENCE_CLASS,
  assertNativeGatewayEvidence,
  buildNativeGatewayEvidence,
  probeNativeGatewayHealth,
  startNativeOpenClawGateway
} from "./native-gateway-capture.mjs";
import { createNativeNodeRuntime } from "./native-node-runtime.mjs";

const ARTIFACT = Object.freeze({
  package: "openclaw",
  version: "2026.7.1-2",
  integrity: `sha512-${"A".repeat(86)}==`
});
const TOKEN = "native-test-token-0123456789";

const FAKE_GATEWAY_SOURCE = `
import { createServer } from "node:http";
const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
if (!process.env.OPENCLAW_GATEWAY_TOKEN || !process.env.OPENCLAW_STATE_DIR) process.exit(2);
const server = createServer((request, response) => {
  response.statusCode = request.url === "/healthz" || request.url === "/readyz" ? 200 : 404;
  response.end("ok");
});
server.listen(port, "127.0.0.1", () => { console.log("[gateway] ready"); });
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 100).unref();
});
`;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createTcpServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.once("error", reject);
  });
}

async function stagedGateway(t, source = FAKE_GATEWAY_SOURCE) {
  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-native-gw-"));
  const runtime = createNativeNodeRuntime({ hostRoot });
  t.after(async () => {
    await runtime.close();
    await rm(hostRoot, { recursive: true, force: true });
  });
  await runtime.createDirectory("/native/openclaw/node_modules/openclaw", { recursive: true });
  await runtime.createDirectory("/native/openclaw/state", { recursive: true });
  await runtime.writeTextFile("/native/openclaw/node_modules/openclaw/openclaw.mjs", source);
  const installed = Object.freeze({
    integrityMatched: true,
    root: "/native/openclaw",
    stateRoot: "/native/openclaw/state",
    executablePath: "/native/openclaw/node_modules/openclaw/openclaw.mjs",
    durationMs: 1_234,
    outputTruncated: false
  });
  return { runtime, installed };
}

test("boots the staged Gateway, probes health, and stops it by signal", async (t) => {
  const { runtime, installed } = await stagedGateway(t);
  const port = await freePort();
  const gateway = await startNativeOpenClawGateway({ runtime, installed, port, token: TOKEN });
  assert.ok(gateway.readyDurationMs >= 0);
  const health = await probeNativeGatewayHealth(port, { attempts: 20, delayMs: 100 });
  assert.equal(health.healthz.status, 200);
  assert.equal(health.readyz.status, 200);
  const termination = await gateway.stop();
  assert.equal(termination.mode, "signal");
  assert.equal(typeof termination.graceful, "boolean");

  const evidence = buildNativeGatewayEvidence({
    artifact: ARTIFACT,
    nodeEngine: ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0",
    install: installed,
    gateway: { port, readyDurationMs: gateway.readyDurationMs },
    health,
    termination,
    capturedAt: "2026-07-22T00:00:00.000Z"
  });
  assert.equal(evidence.class, NATIVE_GATEWAY_EVIDENCE_CLASS);
  assert.equal(evidence.target.runtime, "native-node");
  assert.equal(evidence.target.browserLocal, false);
  assert.equal(assertNativeGatewayEvidence(evidence, { artifact: ARTIFACT }), evidence);
});

test("classifies an exit before readiness as gateway_exited", async (t) => {
  const { runtime, installed } = await stagedGateway(t, "process.exit(3);\n");
  const port = await freePort();
  await assert.rejects(
    startNativeOpenClawGateway({ runtime, installed, port, token: TOKEN }),
    (error) => error.code === "gateway_exited"
  );
});

test("health probe fails closed on non-200 responses and dead ports", async (t) => {
  const port = await freePort();
  const server = createServer((request, response) => {
    response.statusCode = request.url === "/healthz" ? 200 : 500;
    response.end("x");
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    probeNativeGatewayHealth(port, { attempts: 2, delayMs: 10 }),
    (error) => error.code === "health_probe_failed"
  );
  const deadPort = await freePort();
  await assert.rejects(
    probeNativeGatewayHealth(deadPort, { attempts: 2, delayMs: 10 }),
    (error) => error.code === "health_probe_failed"
  );
});

test("the capture script fails fast on a report outside the pinned data root", async () => {
  const scriptPath = fileURLToPath(
    new URL("../../../examples/native-gateway-evidence/capture.mjs", import.meta.url)
  );
  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, CLAWSEMBLY_EVIDENCE_REPORT: "README.md" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise((resolve) => child.once("exit", resolve));
  assert.equal(exitCode, 1);
  assert.match(stderr, /\[native-capture\] failed/u);
});

test("evidence assertion rejects tampering, class confusion, and artifact drift", async (t) => {
  const { installed } = await stagedGateway(t);
  const evidence = buildNativeGatewayEvidence({
    artifact: ARTIFACT,
    nodeEngine: ">=24.15.0 <25",
    install: installed,
    gateway: { port: 18_789, readyDurationMs: 10 },
    health: { healthz: { status: 200 }, readyz: { status: 200 } },
    termination: { mode: "signal", graceful: true },
    capturedAt: "2026-07-22T00:00:00.000Z"
  });
  assertNativeGatewayEvidence(evidence, { artifact: ARTIFACT });

  const tampered = { ...evidence, target: { ...evidence.target, version: "2026.9.9" } };
  assert.throws(
    () => assertNativeGatewayEvidence(tampered, { artifact: { ...ARTIFACT, version: "2026.9.9" } }),
    (error) => error.code === "invalid_native_evidence"
  );
  assert.throws(
    () => assertNativeGatewayEvidence({ ...evidence, class: "browserpod" }),
    (error) => error.code === "invalid_native_evidence"
  );
  assert.throws(
    () => assertNativeGatewayEvidence(evidence, { artifact: { ...ARTIFACT, version: "2026.6.11" } }),
    (error) => error.code === "invalid_native_evidence"
  );
  assert.throws(
    () => assertNativeGatewayEvidence({ ...evidence, target: { ...evidence.target, runtime: "browserpod" } }),
    (error) => error.code === "invalid_native_evidence"
  );
});
