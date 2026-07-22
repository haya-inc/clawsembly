// Plain-Node runtime adapter for the native-Gateway evidence lane (ADR 0006).
// It implements the same duck-typed surface createVerifiedOpenClawInstaller
// consumes from a BrowserRuntime — createDirectory / writeTextFile /
// readTextFile / start — over node:fs and node:child_process, with guest
// paths under "/native" mapped onto one host root directory. It is a native
// host runtime, never a BrowserPod double: provider is "native-node",
// browserLocal is false, and records built on it must never enter the
// BrowserPod evidence class.

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { BrowserRuntimeError, waitForCondition } from "../../browser-runtime/browser-runtime.mjs";

export const NATIVE_GUEST_ROOT = "/native";
const ENV_ENTRY = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const DEFAULT_OUTPUT_LIMIT_BYTES = 2 * 1024 * 1024;

function assertGuestPath(path, label) {
  if (typeof path !== "string" || (path !== NATIVE_GUEST_ROOT && !path.startsWith(`${NATIVE_GUEST_ROOT}/`))
    || path.includes("..") || path.includes("\0")) {
    throw new BrowserRuntimeError("invalid_path", `${label} must be an absolute /native guest path`);
  }
  return path;
}

function resolveNpmInvocation(args) {
  const npmEntry = process.env.npm_execpath;
  if (typeof npmEntry === "string" && npmEntry.length > 0) {
    return { executable: process.execPath, args: [npmEntry, ...args] };
  }
  if (process.platform === "win32") {
    // Spawning npm.cmd without a shell fails on current Node, and running it
    // through a shell would re-parse artifact arguments. Fail closed instead.
    throw new BrowserRuntimeError(
      "npm_unavailable",
      "npm must be resolvable via npm_execpath on Windows; run the capture through an npm script"
    );
  }
  return { executable: "npm", args };
}

/**
 * Creates the native runtime. `hostRoot` is an existing host directory that
 * backs the `/native` guest prefix; every spawned child is SIGKILLed by
 * `close()` if still running. Only the `node` and `npm` executables are
 * accepted, mirroring what the verified installer and Gateway recipes use.
 */
export function createNativeNodeRuntime({ hostRoot, now = Date.now, onAudit } = {}) {
  if (typeof hostRoot !== "string" || hostRoot.length === 0) {
    throw new TypeError("a host root directory is required for the native runtime");
  }
  if (typeof now !== "function") throw new TypeError("the native runtime clock is invalid");
  if (typeof onAudit !== "undefined" && typeof onAudit !== "function") {
    throw new TypeError("the native runtime audit sink is invalid");
  }
  const separator = hostRoot.includes("\\") ? "\\" : "/";
  const mapGuestPath = (value) => {
    if (typeof value !== "string" || !(value === NATIVE_GUEST_ROOT || value.startsWith(`${NATIVE_GUEST_ROOT}/`))) {
      return value;
    }
    const relative = value.slice(NATIVE_GUEST_ROOT.length).replace(/^\//u, "");
    if (relative === "") return hostRoot;
    return `${hostRoot}${separator}${relative.split("/").join(separator)}`;
  };
  const children = new Set();
  let accepting = true;
  let taskSequence = 0;
  const audit = (value) => {
    try { onAudit?.(Object.freeze(value)); }
    catch { /* Diagnostics cannot break the runtime. */ }
  };

  const runtime = {
    provider: "native-node",
    nodeVersion: process.versions.node,
    features: Object.freeze({
      browserLocal: false,
      persistentFilesystem: false,
      portals: false,
      interactiveInput: false,
      processTermination: true,
      hardDispose: false
    }),

    async createDirectory(path, options = {}) {
      assertGuestPath(path, "directory path");
      await mkdir(mapGuestPath(path), { recursive: options.recursive === true });
    },

    async writeTextFile(path, text) {
      assertGuestPath(path, "file path");
      if (typeof text !== "string") throw new TypeError("file content must be a string");
      await writeFile(mapGuestPath(path), text, "utf8");
    },

    async readTextFile(path, options = {}) {
      assertGuestPath(path, "file path");
      const text = await readFile(mapGuestPath(path), "utf8");
      const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
      if (Buffer.byteLength(text, "utf8") > maxBytes) {
        throw new BrowserRuntimeError("file_too_large", "the requested file exceeds its read limit");
      }
      return text;
    },

    async start(command) {
      if (!accepting) throw new BrowserRuntimeError("runtime_closed", "runtime no longer accepts work");
      if (!command || typeof command !== "object") throw new TypeError("a command is required");
      const { executable, args = [], cwd, env = [], outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES } = command;
      if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string")) {
        throw new TypeError("command arguments must be strings");
      }
      if (!Array.isArray(env) || env.some((entry) => typeof entry !== "string" || !ENV_ENTRY.test(entry))) {
        throw new TypeError("command environment entries must be KEY=value strings");
      }
      if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1_024) {
        throw new TypeError("the command output limit is invalid");
      }
      let invocation;
      if (executable === "node") invocation = { executable: process.execPath, args: [...args] };
      else if (executable === "npm") invocation = resolveNpmInvocation(args);
      else throw new BrowserRuntimeError("unsupported_executable", "the native runtime only executes node and npm");

      const id = `native-task-${++taskSequence}`;
      const outputListeners = new Set();
      let transcript = "";
      let transcriptBytes = 0;
      let outputTruncated = false;
      let state = "running";
      const startedAt = now();
      const child = spawn(invocation.executable, invocation.args.map((argument) => mapGuestPath(argument)), {
        cwd: cwd === undefined ? hostRoot : mapGuestPath(assertGuestPath(cwd, "command cwd")),
        env: {
          ...process.env,
          ...Object.fromEntries(env.map((entry) => {
            const index = entry.indexOf("=");
            return [entry.slice(0, index), entry.slice(index + 1)];
          }))
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      children.add(child);
      const ingest = (chunk) => {
        const bytes = chunk.byteLength;
        const remaining = Math.max(0, outputLimitBytes - transcriptBytes);
        if (remaining > 0) {
          const bounded = chunk.subarray(0, Math.min(bytes, remaining));
          const text = bounded.toString("utf8");
          transcript += text;
          transcriptBytes += bounded.byteLength;
          for (const listener of outputListeners) {
            try { listener(text); }
            catch { /* Output consumers cannot break the runtime. */ }
          }
        }
        if (bytes > remaining) outputTruncated = true;
      };
      child.stdout.on("data", ingest);
      child.stderr.on("data", ingest);
      audit({ action: "start", outcome: "running", taskId: id, executable, argCount: args.length });

      const completion = new Promise((resolve) => {
        child.once("error", () => {
          children.delete(child);
          state = "failed";
          resolve(Object.freeze({ status: "failed", outputBytes: transcriptBytes, outputTruncated }));
        });
        child.once("exit", (code, signal) => {
          children.delete(child);
          state = code === 0 ? "completed" : "failed";
          audit({
            action: "complete",
            outcome: state,
            taskId: id,
            durationMs: Math.max(0, now() - startedAt),
            exitCode: code,
            signal: signal ?? null
          });
          resolve(Object.freeze({ status: state, outputBytes: transcriptBytes, outputTruncated }));
        });
      });

      return Object.freeze({
        id,
        get status() { return state; },
        get transcript() { return transcript; },
        get outputTruncated() { return outputTruncated; },
        onOutput(listener, options = {}) {
          if (typeof listener !== "function") {
            throw new BrowserRuntimeError("invalid_listener", "output listener is invalid");
          }
          outputListeners.add(listener);
          if (options.replay !== false && transcript) {
            try { listener(transcript); }
            catch { /* Output consumers cannot break the runtime. */ }
          }
          return () => outputListeners.delete(listener);
        },
        wait() { return completion; },
        waitForOutput(needle, options = {}) {
          if (typeof needle !== "string" || needle.length === 0 || needle.length > 16_384) {
            throw new BrowserRuntimeError("invalid_output_match", "output match is invalid");
          }
          return waitForCondition({
            current: () => transcript,
            subscribe: (listener) => {
              outputListeners.add(listener);
              return () => outputListeners.delete(listener);
            },
            matches: () => transcript.includes(needle),
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            timeoutMessage: `timed out waiting for "${needle}"`
          });
        },
        terminate(signal = "SIGTERM") {
          if (signal !== "SIGTERM" && signal !== "SIGKILL") {
            throw new TypeError("only SIGTERM and SIGKILL are supported");
          }
          try { child.kill(signal); }
          catch { /* Already exited. */ }
        }
      });
    },

    async close() {
      accepting = false;
      for (const child of children) {
        try { child.kill("SIGKILL"); }
        catch { /* Already exited. */ }
      }
      children.clear();
    }
  };
  return Object.freeze(runtime);
}
