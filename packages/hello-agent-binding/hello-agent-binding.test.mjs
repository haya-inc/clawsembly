import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import { createEmbedManifest } from "../embed-sdk/embed-manifest.mjs";
import { loadVerifiedCompatibilityReport } from "../embed-sdk/report-loader.mjs";
import { HELLO_AGENT_ARTIFACT } from "./hello-agent-artifact.generated.mjs";
import {
  HELLO_AGENT_CAPABILITY_REQUIREMENTS,
  HelloAgentBindingError,
  assertExactHelloAgentArtifact,
  assertHelloAgentRuntimeEvidence,
  bootHelloAgentEmbed,
  createHelloAgentClient,
  createVerifiedHelloAgentInstaller,
  createVerifiedHelloAgentProcess,
  deriveHelloAgentCheckStatuses,
  helloAgentEvidenceRecord
} from "./hello-agent-binding.mjs";

const IDENTITY = Object.freeze({
  package: HELLO_AGENT_ARTIFACT.name,
  version: HELLO_AGENT_ARTIFACT.version,
  integrity: HELLO_AGENT_ARTIFACT.integrity
});

/**
 * A local BrowserPod provider double: the documented 2.x provider surface
 * backed by a real temporary directory and real Node child processes. The
 * hello-agent boot recipe, protocol, and cooperative shutdown execute for
 * real here, without a metered runtime. Guest paths stay drive-relative so
 * the same absolute guest path works for the host and the spawned children
 * on both POSIX and Windows.
 */
async function localNodePod(t, options = {}) {
  const hostRoot = await mkdtemp(join(tmpdir(), "clawsembly-hello-"));
  const drive = /^[A-Za-z]:/u.test(hostRoot) ? hostRoot.slice(0, 2) : "";
  const guestRoot = hostRoot.slice(drive.length).replaceAll("\\", "/");
  const hostPath = (guestPath) => `${drive}${guestPath}`;
  const calls = [];
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      try { child.kill("SIGKILL"); } catch { /* Already exited. */ }
    }
    await rm(hostRoot, { recursive: true, force: true }).catch(() => {});
  });

  const BrowserPod = {
    async boot(bootOptions) {
      calls.push(bootOptions);
      return {
        onPortal() {},
        async createCustomTerminal(terminalOptions) {
          return { onOutput: terminalOptions.onOutput };
        },
        async run(executable, args, runOptions = {}) {
          if (executable !== "node") throw new Error(`local pod cannot run ${executable}`);
          const child = spawn(process.execPath, args, {
            cwd: hostPath(runOptions.cwd ?? guestRoot),
            env: {
              ...process.env,
              ...Object.fromEntries((runOptions.env ?? []).map((entry) => {
                const separator = entry.indexOf("=");
                return [entry.slice(0, separator), entry.slice(separator + 1)];
              }))
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true
          });
          children.add(child);
          child.stdout.on("data", (chunk) => runOptions.terminal?.onOutput?.(chunk));
          child.stderr.on("data", (chunk) => runOptions.terminal?.onOutput?.(chunk));
          return new Promise((resolve, reject) => {
            child.once("error", (error) => {
              children.delete(child);
              reject(error);
            });
            child.once("exit", (code) => {
              children.delete(child);
              if (code === 0) resolve({});
              else reject(new Error(`local pod task exited with ${code}`));
            });
          });
        },
        async createDirectory(path, { recursive } = {}) {
          await mkdir(hostPath(path), { recursive: recursive === true });
        },
        async createFile(path) {
          let text = "";
          return {
            async write(value) { text += value; },
            async close() {
              const finalText = options.tamper ? options.tamper(path, text) : text;
              await writeFile(hostPath(path), finalText, "utf8");
            }
          };
        },
        async openFile(path) {
          const target = hostPath(path);
          const info = await stat(target);
          const text = await readFile(target, "utf8");
          return {
            async getSize() { return info.size; },
            async read() { return text; },
            async close() {}
          };
        }
      };
    }
  };
  return { BrowserPod, guestRoot, hostPath, calls };
}

async function localRuntime(t, options = {}) {
  const pod = await localNodePod(t, options);
  const runtime = await createBrowserPodRuntime({
    BrowserPod: pod.BrowserPod,
    apiKey: "local-provider-double"
  });
  return { ...pod, runtime };
}

async function verifyHelloReport(overrides = {}) {
  const value = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "supported",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    artifact: { ...IDENTITY },
    evidence: [{
      id: "hello-agent-runtime",
      kind: "browser-runtime",
      path: `evidence/hello-agent-${IDENTITY.version}.json`,
      sha256: "a".repeat(64)
    }],
    checks: [
      { id: "hello-agent-install", status: "pass" },
      { id: "hello-agent-boot", status: "pass" },
      { id: "hello-agent-protocol", status: "pass" }
    ],
    ...overrides
  };
  const body = `${JSON.stringify(value)}\n`;
  return loadVerifiedCompatibilityReport({
    url: "https://example.com/hello-agent-compatibility.json",
    sha256: createHash("sha256").update(body).digest("hex"),
    maxAgeMs: 24 * 60 * 60 * 1_000,
    artifact: value.artifact,
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
  }, {
    fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } })
  });
}

async function waitFor(read, { timeoutMs = 5_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== undefined) return value;
    } catch { /* Retry until the deadline. */ }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("condition was not met before the deadline");
}

test("pins the exact generated artifact identity and declares no capabilities", () => {
  const exact = assertExactHelloAgentArtifact(IDENTITY);
  assert.deepEqual(exact, IDENTITY);
  assert.throws(() => assertExactHelloAgentArtifact({ ...IDENTITY, package: "openclaw" }), /exact hello-agent/u);
  assert.throws(() => assertExactHelloAgentArtifact({ ...IDENTITY, integrity: "latest" }), /exact hello-agent/u);
  assert.equal(HELLO_AGENT_CAPABILITY_REQUIREMENTS.length, 0);
  assert.equal(Object.isFrozen(HELLO_AGENT_CAPABILITY_REQUIREMENTS), true);
  assert.equal(HELLO_AGENT_ARTIFACT.registryPublished, false);
  assert.equal(HELLO_AGENT_ARTIFACT.files.length, 3);
  const protocolFile = HELLO_AGENT_ARTIFACT.files.find((file) => file.relativePath === "protocol.json");
  assert.equal(
    createHash("sha256").update(protocolFile.contents).digest("hex"),
    HELLO_AGENT_ARTIFACT.protocolSha256
  );
});

test("stages the exact artifact with per-file verification and rejects cross-version reuse", async (t) => {
  const { runtime, guestRoot } = await localRuntime(t);
  const audits = [];
  const installer = createVerifiedHelloAgentInstaller({
    runtime,
    artifact: IDENTITY,
    root: `${guestRoot}/hello`,
    onAudit: (event) => audits.push(event)
  });
  assert.equal(installer.state, "idle");
  const installed = await installer.install();
  assert.equal(installed.integrityMatched, true);
  assert.equal(installed.fileCount, HELLO_AGENT_ARTIFACT.files.length);
  assert.equal(installer.state, "installed");
  assert.equal(await installer.install(), installed);
  const stagedProtocol = await runtime.readTextFile(installed.protocolPath, { maxBytes: 8_192 });
  assert.equal(
    createHash("sha256").update(stagedProtocol).digest("hex"),
    HELLO_AGENT_ARTIFACT.protocolSha256
  );
  const record = JSON.parse(await runtime.readTextFile(installed.installRecordPath, { maxBytes: 8_192 }));
  assert.deepEqual(record.artifact, IDENTITY);
  assert.equal(record.tarballIntegrity, HELLO_AGENT_ARTIFACT.integrity);
  assert.equal(JSON.stringify(audits).includes("sessionToken"), false);

  const crossVersion = createVerifiedHelloAgentInstaller({
    runtime,
    artifact: { ...IDENTITY, version: "9.9.9" },
    root: `${guestRoot}/hello-cross`
  });
  await assert.rejects(
    crossVersion.install(),
    (error) => error instanceof HelloAgentBindingError && error.code === "artifact_mismatch"
  );
  assert.equal(crossVersion.state, "failed");
});

test("tampered staging fails closed before anything executes", async (t) => {
  const { runtime, guestRoot } = await localRuntime(t, {
    tamper: (path, text) => (path.endsWith("/hello-agent.mjs") ? text.replace("hello", "he11o") : text)
  });
  const installer = createVerifiedHelloAgentInstaller({
    runtime,
    artifact: IDENTITY,
    root: `${guestRoot}/hello`
  });
  await assert.rejects(
    installer.install(),
    (error) => error instanceof HelloAgentBindingError && error.code === "staging_verification_failed"
  );
  assert.equal(installer.state, "failed");
});

test("boots to dual readiness, answers exactly hello.say, and stops cooperatively", async (t) => {
  const { runtime, guestRoot } = await localRuntime(t);
  const audits = [];
  const installer = createVerifiedHelloAgentInstaller({
    runtime,
    artifact: IDENTITY,
    root: `${guestRoot}/hello`
  });
  const helloProcess = createVerifiedHelloAgentProcess({
    runtime,
    installer,
    readyTimeoutMs: 20_000,
    onAudit: (event) => audits.push(event)
  });
  assert.equal(helloProcess.state, "idle");
  assert.throws(() => helloProcess.credentials(), (error) => error.code === "hello_not_ready");

  const readiness = await helloProcess.start();
  assert.deepEqual(readiness, { output: true, readyFile: true, protocol: "clawsembly-hello/1" });
  assert.equal(helloProcess.state, "ready");
  await assert.rejects(helloProcess.start(), (error) => error.code === "invalid_state");

  const client = createHelloAgentClient({
    runtime,
    process: helloProcess,
    timeoutMs: 20_000,
    onAudit: (event) => audits.push(event)
  });
  const answer = await client.say({ name: "Ada" });
  assert.deepEqual(answer, { greeting: "Hello, Ada!" });
  assert.equal(client.requestCount, 1);
  await assert.rejects(client.say({ name: "" }), (error) => error.code === "invalid_params");
  assert.equal(client.requestCount, 1);

  // A raw request with a forged session token is rejected inside the guest.
  await runtime.writeTextFile(
    `${helloProcess.session.requestsRoot}/request-intruder-1.json`,
    JSON.stringify({
      schemaVersion: 1,
      id: "intruder-1",
      method: "hello.say",
      sessionToken: "forged-session-token",
      params: { name: "Mallory" }
    })
  );
  const rejected = await waitFor(async () => JSON.parse(await runtime.readTextFile(
    `${helloProcess.session.responsesRoot}/response-intruder-1.json`,
    { maxBytes: 4_096 }
  )), { timeoutMs: 10_000 });
  assert.deepEqual(rejected, {
    schemaVersion: 1,
    id: "intruder-1",
    ok: false,
    error: { code: "invalid_request" }
  });

  const installed = await installer.install();
  const stop = await helloProcess.stop();
  assert.equal(stop.complete, true);
  assert.equal(stop.mode, "guest-supervisor");
  assert.equal(helloProcess.state, "stopped");
  assert.deepEqual(await helloProcess.stop(), stop);
  await assert.rejects(client.say({ name: "Ada" }), (error) => error.code === "hello_not_ready");

  const evidence = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    target: {
      runtime: "browserpod",
      browserLocal: true,
      runtimeVersion: runtime.version,
      browser: "local Node provider double (no metered runtime)"
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
      termination: { mode: stop.mode, result: stop.complete ? "pass" : "fail" }
    },
    protocol: { method: "hello.say", roundTrips: client.requestCount }
  };
  assert.equal(assertHelloAgentRuntimeEvidence(evidence), evidence);
  const record = await helloAgentEvidenceRecord(evidence);
  assert.match(record.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(record.kind, "browser-runtime");
  const tamperedRecord = await helloAgentEvidenceRecord({
    ...evidence,
    protocol: { ...evidence.protocol, roundTrips: 2 }
  });
  assert.notEqual(tamperedRecord.sha256, record.sha256);
  assert.throws(
    () => assertHelloAgentRuntimeEvidence({ ...evidence, artifact: { ...IDENTITY, version: "9.9.9" } }),
    /artifact identity/u
  );
  assert.deepEqual(deriveHelloAgentCheckStatuses(evidence), {
    "hello-agent-install": "pass",
    "hello-agent-boot": "pass",
    "hello-agent-protocol": "pass"
  });
  assert.deepEqual(deriveHelloAgentCheckStatuses(), {
    "hello-agent-install": "pending",
    "hello-agent-boot": "pending",
    "hello-agent-protocol": "pending"
  });

  const auditText = JSON.stringify(audits);
  assert.equal(auditText.includes(helloProcess.credentials ? "forged-session-token" : ""), false);
  assert.equal(auditText.includes("Ada"), false);
  assert.equal(auditText.includes("Mallory"), false);
});

test("bootHelloAgentEmbed composes the unmodified core for a second upstream", async (t) => {
  const blockedPod = await localNodePod(t);
  const probingReport = await verifyHelloReport({ status: "probing", evidence: [], checks: [
    { id: "hello-agent-install", status: "pending" },
    { id: "hello-agent-boot", status: "pending" },
    { id: "hello-agent-protocol", status: "pending" }
  ] });
  await assert.rejects(
    bootHelloAgentEmbed({
      manifest: createEmbedManifest({ report: probingReport }),
      BrowserPod: blockedPod.BrowserPod,
      browserPodApiKey: "local-provider-double"
    }),
    /verified BrowserPod launch blocked/u
  );
  assert.equal(blockedPod.calls.length, 0);

  const pod = await localNodePod(t);
  const manifest = createEmbedManifest({
    report: await verifyHelloReport(),
    capabilities: [{ capability: "clock.read", scope: "session:local", maxCalls: 1 }]
  });
  assert.equal(manifest.launchable, true);
  assert.equal(manifest.artifact.package, HELLO_AGENT_ARTIFACT.name);

  const session = await bootHelloAgentEmbed({
    manifest,
    BrowserPod: pod.BrowserPod,
    browserPodApiKey: "local-provider-double",
    workspaceId: "primary",
    sessionId: "hello-session",
    installRoot: `${pod.guestRoot}/hello`,
    capabilityHandlers: { "clock.read": async () => ({ now: "host-time" }) },
    processOptions: { readyTimeoutMs: 20_000 }
  });
  assert.equal(pod.calls[0].storageKey, "clawsembly:clawsembly-hello-agent:0.1.0:primary");
  assert.deepEqual(session.capabilities.subject, {
    artifact: { ...IDENTITY },
    runtime: "browserpod",
    sessionId: "hello-session"
  });
  assert.equal(session.process.state, "idle");

  await session.process.start();
  const client = session.createClient({ timeoutMs: 20_000 });
  assert.deepEqual(await client.say({ name: "Clawsembly" }), { greeting: "Hello, Clawsembly!" });

  await assert.rejects(
    session.capabilities.request({ id: "clock-1", capability: "clock.read", scope: "session:local", input: {} }),
    (error) => error.code === "not_granted"
  );
  session.permissions.approve("clock.read", "session:local", { durationMs: 60_000, maxCalls: 1 });
  assert.deepEqual(
    await session.capabilities.request({ id: "clock-2", capability: "clock.read", scope: "session:local", input: {} }),
    { now: "host-time" }
  );

  const refused = session.dispose();
  assert.equal(refused.complete, false);
  assert.match(refused.reason, /must stop/u);

  const closed = await session.close();
  assert.equal(closed.logicalSessionClosed, true);
  assert.equal(closed.gatewayStop.complete, true);
  assert.equal(session.process.state, "stopped");
  assert.equal(session.closed, true);
  await assert.rejects(client.say({ name: "Clawsembly" }), (error) => error.code === "client_closed");
});
