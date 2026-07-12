import {
  BrowserRuntimeError,
  assertAbsoluteGuestPath,
  normalizeCommand
} from "./browser-runtime.mjs";

export const COOPERATIVE_SUPERVISOR_PREFIX = "[clawsembly-supervisor]";
const PROCESS_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

export const COOPERATIVE_SUPERVISOR_SOURCE = String.raw`
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

const PREFIX = "${COOPERATIVE_SUPERVISOR_PREFIX}";
const configPath = process.argv[2];
let config;
try { config = JSON.parse(await readFile(configPath, "utf8")); }
catch { console.error(PREFIX + JSON.stringify({ event: "error", code: "invalid_config" })); process.exit(1); }

if (!config || typeof config.executable !== "string" || !Array.isArray(config.args)
  || config.args.some((arg) => typeof arg !== "string") || typeof config.cwd !== "string"
  || typeof config.controlPath !== "string" || typeof config.nonce !== "string"
  || !Number.isSafeInteger(config.graceMs) || config.graceMs < 100 || config.graceMs > 30000) {
  console.error(PREFIX + JSON.stringify({ event: "error", code: "invalid_config" }));
  process.exit(1);
}

let requestedStop = false;
let forceTimer;
const child = spawn(config.executable, config.args, {
  cwd: config.cwd,
  env: process.env,
  stdio: "inherit"
});

const stopChild = () => {
  if (requestedStop || child.exitCode !== null || child.signalCode !== null) return;
  requestedStop = true;
  console.log(PREFIX + JSON.stringify({ event: "stopping", signal: "SIGTERM" }));
  child.kill("SIGTERM");
  forceTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      console.log(PREFIX + JSON.stringify({ event: "forcing", signal: "SIGKILL" }));
      child.kill("SIGKILL");
    }
  }, config.graceMs);
};

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, stopChild);
const poll = setInterval(async () => {
  try {
    const control = JSON.parse(await readFile(config.controlPath, "utf8"));
    if (control?.action === "stop" && control?.nonce === config.nonce) stopChild();
  } catch { /* No matching control file yet. */ }
}, 100);

child.once("spawn", () => {
  console.log(PREFIX + JSON.stringify({ event: "ready" }));
});

const outcome = await new Promise((resolve) => {
  child.once("error", () => resolve({ code: null, signal: null, error: true }));
  child.once("exit", (code, signal) => resolve({ code, signal, error: false }));
});
clearInterval(poll);
clearTimeout(forceTimer);
console.log(PREFIX + JSON.stringify({
  event: "exit",
  requestedStop,
  code: outcome.code,
  signal: outcome.signal,
  error: outcome.error
}));
process.exitCode = requestedStop ? 0 : outcome.error ? 1 : outcome.code ?? 1;
`;

function validateOptions({ runtime, root, id, graceMs, readyTimeoutMs, nonceFactory }) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.start !== "function"
    || typeof runtime.createDirectory !== "function" || typeof runtime.writeTextFile !== "function") {
    throw new TypeError("a BrowserPod runtime is required for cooperative supervision");
  }
  assertAbsoluteGuestPath(root, "cooperative process root");
  if (root === "/" || root.endsWith("/")) throw new TypeError("cooperative process root is invalid");
  if (typeof id !== "string" || !PROCESS_ID_PATTERN.test(id)) {
    throw new TypeError("cooperative process identifier is invalid");
  }
  if (!Number.isSafeInteger(graceMs) || graceMs < 100 || graceMs > 30_000) {
    throw new TypeError("cooperative process grace period is invalid");
  }
  if (!Number.isSafeInteger(readyTimeoutMs) || readyTimeoutMs < 100 || readyTimeoutMs > 60_000) {
    throw new TypeError("cooperative process readiness timeout is invalid");
  }
  if (typeof nonceFactory !== "function") throw new TypeError("cooperative process nonce factory is invalid");
}

function validateNonce(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 128
    || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError("cooperative process nonce is invalid");
  }
  return value;
}

export async function startCooperativeProcess({
  runtime,
  root,
  id,
  command: untrustedCommand,
  graceMs = 5_000,
  readyTimeoutMs = 10_000,
  nonceFactory = () => crypto.randomUUID()
}) {
  validateOptions({ runtime, root, id, graceMs, readyTimeoutMs, nonceFactory });
  const command = normalizeCommand(untrustedCommand);
  if (!command.cwd) throw new TypeError("cooperative process requires an explicit cwd");
  const nonce = validateNonce(nonceFactory());
  const supervisorPath = `${root}/supervisor-${id}.mjs`;
  const configPath = `${root}/supervisor-${id}.json`;
  const controlPath = `${root}/stop-${id}.json`;
  await runtime.createDirectory(root, { recursive: true });
  await runtime.writeTextFile(supervisorPath, COOPERATIVE_SUPERVISOR_SOURCE);
  await runtime.writeTextFile(configPath, `${JSON.stringify({
    executable: command.executable,
    args: command.args,
    cwd: command.cwd,
    controlPath,
    nonce,
    graceMs
  }, null, 2)}\n`);

  const task = await runtime.start({
    executable: "node",
    args: [supervisorPath, configPath],
    cwd: root,
    env: command.env,
    echo: false,
    cols: command.cols,
    rows: command.rows,
    outputLimitBytes: command.outputLimitBytes
  });
  const readyController = new AbortController();
  const ready = task.waitForOutput(`${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}`, {
    timeoutMs: readyTimeoutMs,
    signal: readyController.signal
  });
  const outcome = await Promise.race([
    ready.then(() => "ready"),
    task.wait().then(() => "exit")
  ]);
  readyController.abort();
  if (outcome !== "ready") {
    throw new BrowserRuntimeError("supervisor_exited", "cooperative supervisor exited before readiness");
  }

  let stopRequested = false;
  return Object.freeze({
    id,
    mode: "guest-supervisor",
    task,
    get stopRequested() { return stopRequested; },
    async stop({ timeoutMs = graceMs + 5_000 } = {}) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < graceMs || timeoutMs > 60_000) {
        throw new TypeError("cooperative stop timeout is invalid");
      }
      if (!stopRequested) {
        stopRequested = true;
        await runtime.writeTextFile(controlPath, `${JSON.stringify({ action: "stop", nonce })}\n`);
      }
      let timer;
      const completion = await Promise.race([
        task.wait().then((result) => ({ kind: "complete", result })),
        new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs); })
      ]).finally(() => clearTimeout(timer));
      if (completion.kind === "timeout") {
        return Object.freeze({
          complete: false,
          mode: "guest-supervisor",
          reason: "cooperative process did not exit before timeout",
          taskId: task.id
        });
      }
      const acknowledgedStop = task.transcript.includes(
        `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"exit","requestedStop":true,`
      );
      return Object.freeze({
        complete: completion.result.status === "completed" && acknowledgedStop,
        mode: "guest-supervisor",
        reason: completion.result.status === "completed" && acknowledgedStop
          ? "guest child acknowledged cooperative stop"
          : "cooperative supervisor did not acknowledge the requested stop",
        taskId: task.id
      });
    }
  });
}
