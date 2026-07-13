// Shared fake BrowserPod 2.12.1 fixtures for tests. Upstream behavior that
// the fakes mirror (terminal output framing, portal events, supervisor
// ready/exit lines, health and preflight evidence) is defined once here so a
// BrowserPod upgrade needs one edit instead of six synchronized ones.
//
// This module must stay outside packages/{browser-runtime,capability-broker,
// embed-sdk}: scripts/build-sdk-package.mjs packs every non-test .mjs from
// those directories into the published SDK tarball.
import { EVIDENCE_PREFIX } from "../browser-runtime/browserpod-preflight.mjs";
import { COOPERATIVE_SUPERVISOR_PREFIX } from "../browser-runtime/cooperative-process.mjs";
import { BROWSERPOD_HEALTH_PREFIX } from "../browser-runtime/openclaw-gateway.mjs";

export const TEST_OPENCLAW_INTEGRITY = `sha512-${"A".repeat(86)}==`;

export const TEST_OPENCLAW_ARTIFACT = Object.freeze({
  package: "openclaw",
  version: "2026.6.11",
  integrity: TEST_OPENCLAW_INTEGRITY
});

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Encodes text the way BrowserPod 2.12.1 frames terminal output by default. */
export function terminalBuffer(text) {
  return new TextEncoder().encode(text).buffer;
}

export function preflightEvidenceLine(overrides = {}) {
  return `${EVIDENCE_PREFIX}${JSON.stringify({
    node: "22.19.0",
    platform: "linux",
    arch: "wasm32",
    cryptoVerify: true,
    sqlite: true,
    ...overrides
  })}\n`;
}

export function healthEvidenceLine(overrides = {}) {
  return `${BROWSERPOD_HEALTH_PREFIX}${JSON.stringify({
    healthz: { status: 200, body: "{\"ok\":true}" },
    readyz: { status: 200, body: "{\"ready\":true}" },
    ...overrides
  })}\n`;
}

export function supervisorReadyTranscript() {
  return `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"ready"}\n[gateway] ready\n`;
}

export function supervisorExitTranscript() {
  return `${COOPERATIVE_SUPERVISOR_PREFIX}{"event":"exit","requestedStop":true,"code":0,"signal":null,"error":false}\n`;
}

/**
 * Fake BrowserPod provider (the vendor `BrowserPod.boot` surface).
 *
 * Records every provider call as `[name, detail]` tuples in `calls`, backs
 * `createFile`/`openFile` with one shared `files` map, and exposes emit
 * helpers for terminal output and portal events. Per-test command behavior is
 * injected through `onRun`, which receives the run context plus an `emit`
 * helper bound to that run's terminal.
 */
export function createFakeBrowserPod({
  files = new Map(),
  onRun = () => ({}),
  onFileClose,
  missingFiles = "empty"
} = {}) {
  const calls = [];
  const portalHandlers = [];
  let latestTerminalOutput;
  const fake = {
    calls,
    files,
    emitPortal(value) {
      for (const handler of [...portalHandlers]) handler(value);
    },
    emitOutput(text) {
      latestTerminalOutput(terminalBuffer(text));
    },
    emitRawOutput(value, vt) {
      latestTerminalOutput(value, vt);
    },
    BrowserPod: {
      async boot(options) {
        calls.push(["boot", options]);
        return {
          onPortal(handler) { portalHandlers.push(handler); },
          async createCustomTerminal(terminalOptions) {
            calls.push(["terminal", { cols: terminalOptions.cols, rows: terminalOptions.rows }]);
            latestTerminalOutput = terminalOptions.onOutput;
            return { emit: terminalOptions.onOutput };
          },
          run(executable, args, runOptions) {
            calls.push(["run", {
              executable,
              args,
              env: runOptions?.env,
              cwd: runOptions?.cwd,
              echo: runOptions?.echo
            }]);
            return Promise.resolve(onRun({
              executable,
              args,
              options: runOptions,
              emit: (text) => runOptions.terminal.emit(terminalBuffer(text)),
              emitPortal: fake.emitPortal,
              files
            }));
          },
          async createDirectory(path, directoryOptions) {
            calls.push(["mkdir", { path, options: directoryOptions }]);
          },
          async createFile(path, mode) {
            calls.push(["createFile", { path, mode }]);
            let text = "";
            return {
              async write(value) {
                text += value;
                files.set(path, text);
                return value.length;
              },
              async close() {
                calls.push(["close", path]);
                await onFileClose?.(path);
              }
            };
          },
          async openFile(path, mode) {
            calls.push(["openFile", { path, mode }]);
            if (!files.has(path) && missingFiles === "throw") {
              throw new Error(`missing fake file: ${path}`);
            }
            const text = files.get(path) ?? "";
            return {
              async getSize() { return text.length; },
              async read(length) {
                return typeof length === "number" ? text.slice(0, length) : text;
              },
              async close() { calls.push(["close", path]); }
            };
          }
        };
      }
    }
  };
  return fake;
}

/**
 * Fake BrowserRuntime (the surface `createBrowserPodRuntime` returns), for
 * tests of layers built on top of it. Command routing is injected through
 * `onStart(command, { starts, files })`.
 */
export function createFakeRuntime({
  provider = "browserpod",
  onStart,
  onWriteTextFile
} = {}) {
  const files = new Map();
  const commands = [];
  let starts = 0;
  return {
    provider,
    files,
    commands,
    get starts() { return starts; },
    async createDirectory() {},
    async writeTextFile(path, source) {
      files.set(path, source);
      await onWriteTextFile?.(path, source);
    },
    async readTextFile(path) {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path);
    },
    async start(command) {
      starts += 1;
      commands.push(command);
      return onStart(command, { starts, files });
    },
    async waitForPortal(port) {
      return { port, url: "https://browserpod.example/session", visibility: "public-url" };
    }
  };
}

/** Fake runtime task that is already settled with a fixed transcript. */
export function createFakeTask({
  id,
  status = "completed",
  transcript = "",
  replayOnOutput = true
} = {}) {
  return {
    id,
    status,
    transcript,
    outputTruncated: false,
    onOutput(listener) {
      if (replayOnOutput) listener(transcript);
      return () => true;
    },
    async wait() {
      return { status, outputBytes: transcript.length, outputTruncated: false };
    }
  };
}

/**
 * Fake cooperative-supervisor Gateway task: starts running with the ready
 * transcript and completes with the supervisor exit line when `stop()` is
 * invoked (normally from a `stop-gateway.json` write hook).
 */
export function createFakeSupervisorTask({ id = "gateway-task-1" } = {}) {
  const completion = deferred();
  const listeners = new Set();
  let transcript = supervisorReadyTranscript();
  let status = "running";
  const task = {
    id,
    get status() { return status; },
    get transcript() { return transcript; },
    outputTruncated: false,
    onOutput(listener, options = {}) {
      listeners.add(listener);
      if (options.replay !== false && transcript) listener(transcript);
      return () => listeners.delete(listener);
    },
    wait() { return completion.promise; },
    waitForOutput(needle) {
      return transcript.includes(needle)
        ? Promise.resolve(transcript)
        : Promise.reject(new Error(`missing ${needle}`));
    }
  };
  return {
    task,
    stop() {
      transcript += supervisorExitTranscript();
      for (const listener of [...listeners]) listener(transcript);
      status = "completed";
      completion.resolve({ status: "completed", outputBytes: transcript.length, outputTruncated: false });
    }
  };
}
