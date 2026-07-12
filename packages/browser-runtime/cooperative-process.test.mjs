import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COOPERATIVE_SUPERVISOR_PREFIX,
  COOPERATIVE_SUPERVISOR_SOURCE,
  startCooperativeProcess
} from "./cooperative-process.mjs";

function waitForOutput(process, output, needle) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`missing output: ${needle}`)), 5_000);
    const inspect = (chunk) => {
      output.value += chunk;
      if (output.value.includes(needle)) {
        clearTimeout(timeout);
        resolve();
      }
    };
    process.stdout.on("data", inspect);
    process.stderr.on("data", inspect);
  });
}

test("guest supervisor stops a real child through a nonce-bound control file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "clawsembly-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const supervisorPath = join(root, "supervisor.mjs");
  const configPath = join(root, "config.json");
  const controlPath = join(root, "stop.json");
  const nonce = "supervisor_nonce_123456";
  await writeFile(supervisorPath, COOPERATIVE_SUPERVISOR_SOURCE, "utf8");
  await writeFile(configPath, JSON.stringify({
    executable: process.execPath,
    args: [
      "--input-type=module",
      "-e",
      "process.on('SIGTERM',()=>{console.log('child-stopped');process.exit(0)});console.log('child-started');setInterval(()=>{},1000)"
    ],
    cwd: root,
    controlPath,
    nonce,
    graceMs: 500
  }), "utf8");

  const child = spawn(process.execPath, [supervisorPath, configPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = { value: "" };
  await waitForOutput(child, output, "child-started");
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await writeFile(controlPath, JSON.stringify({ action: "stop", nonce }), "utf8");
  const exitCode = await exited;

  assert.equal(exitCode, 0);
  assert.equal(output.value.includes(`${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}`), true);
  assert.match(output.value, /child-started/u);
  // Windows terminates the child without running its SIGTERM handler, so the
  // graceful acknowledgement is only observable on POSIX hosts.
  if (process.platform !== "win32") assert.match(output.value, /child-stopped/u);
  assert.equal(output.value.includes(`${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"stopping"`), true);
  assert.match(output.value, /"event":"exit","requestedStop":true/u);
});

test("host helper keeps environment secrets out of the persisted supervisor config", async () => {
  const files = new Map();
  let completionResolve;
  const completion = new Promise((resolve) => { completionResolve = resolve; });
  const task = {
    id: "browserpod-task-supervised",
    status: "running",
    transcript: `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}\n`,
    outputTruncated: false,
    onOutput() { return () => false; },
    wait() { return completion; },
    waitForOutput() { return Promise.resolve(this.transcript); },
    terminate() { throw new Error("unsupported"); }
  };
  let startCommand;
  const runtime = {
    provider: "browserpod",
    async createDirectory() {},
    async writeTextFile(path, text) {
      files.set(path, text);
      if (path.endsWith("/stop-gateway.json")) {
        task.transcript += `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"exit","requestedStop":true,"code":0,"signal":null,"error":false}\n`;
        completionResolve({ status: "completed", outputBytes: 0, outputTruncated: false });
      }
    },
    async start(command) { startCommand = command; return task; }
  };

  const processHandle = await startCooperativeProcess({
    runtime,
    root: "/workspace/supervision",
    id: "gateway",
    command: {
      executable: "node",
      args: ["openclaw.mjs", "gateway"],
      cwd: "/workspace",
      env: ["OPENCLAW_GATEWAY_TOKEN=ephemeral-secret"]
    },
    nonceFactory: () => "supervisor_nonce_123456"
  });
  const persisted = [...files.entries()].find(([path]) => path.endsWith("/supervisor-gateway.json"))?.[1];
  assert.equal(persisted.includes("ephemeral-secret"), false);
  assert.deepEqual(startCommand.env, ["OPENCLAW_GATEWAY_TOKEN=ephemeral-secret"]);
  assert.deepEqual(await processHandle.stop(), {
    complete: true,
    mode: "guest-supervisor",
    reason: "guest child acknowledged cooperative stop",
    taskId: "browserpod-task-supervised"
  });
  assert.match(files.get("/workspace/supervision/stop-gateway.json"), /supervisor_nonce_123456/u);
});

test("does not claim a cooperative stop when the child exits before the request", async () => {
  const files = new Map();
  const task = {
    id: "already-exited",
    transcript: `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}\n${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"exit","requestedStop":false,"code":0,"signal":null,"error":false}\n`,
    waitForOutput: async () => {},
    wait: async () => ({ status: "completed", code: 0, signal: null })
  };
  const runtime = {
    provider: "browserpod",
    async createDirectory() {},
    async writeTextFile(path, text) { files.set(path, text); },
    async start() { return task; }
  };
  const supervised = await startCooperativeProcess({
    runtime,
    root: "/workspace/supervision",
    id: "early-exit",
    command: { executable: "node", args: ["worker.mjs"], cwd: "/workspace" },
    nonceFactory: () => "acknowledgement_nonce"
  });
  const result = await supervised.stop();
  assert.equal(result.complete, false);
  assert.match(result.reason, /did not acknowledge/u);
});
