import {
  BROWSER_RUNTIME_CONTRACT_VERSION,
  BrowserRuntimeError,
  assertAbsoluteGuestPath,
  normalizeCommand,
  waitForCondition
} from "./browser-runtime.mjs";

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
export const BROWSERPOD_ADAPTER_VERSION = "2.12.1";

function validateApiKey(apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim().length < 1 || apiKey.length > 4_096) {
    throw new BrowserRuntimeError("credential_required", "a BrowserPod API key is required");
  }
  return apiKey;
}

function validateStorageKey(storageKey) {
  if (storageKey === undefined) return undefined;
  if (typeof storageKey !== "string" || !STORAGE_KEY_PATTERN.test(storageKey)) {
    throw new BrowserRuntimeError("invalid_storage_key", "BrowserPod storage key is invalid");
  }
  return storageKey;
}

function safeAudit(sink, event) {
  try { sink?.(Object.freeze(event)); }
  catch { /* Audit consumers cannot break the runtime boundary. */ }
}

function portalRecord(value) {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.port)
    || value.port < 1 || value.port > 65_535 || typeof value.url !== "string") return undefined;
  let url;
  try { url = new URL(value.url); }
  catch { return undefined; }
  if (url.protocol !== "https:") return undefined;
  return Object.freeze({ port: value.port, url: url.toString(), visibility: "public-url" });
}

export async function createBrowserPodRuntime({
  BrowserPod,
  apiKey,
  storageKey,
  onAudit,
  now = Date.now
}) {
  if (!BrowserPod || typeof BrowserPod.boot !== "function") {
    throw new BrowserRuntimeError("provider_unavailable", "BrowserPod.boot is unavailable");
  }
  const credential = validateApiKey(apiKey);
  const persistenceKey = validateStorageKey(storageKey);
  if (typeof now !== "function") throw new BrowserRuntimeError("invalid_clock", "runtime clock is invalid");
  const bootStartedAt = now();
  let pod;
  try {
    pod = await BrowserPod.boot({
      apiKey: credential,
      nodeVersion: "22",
      ...(persistenceKey ? { storageKey: persistenceKey } : {})
    });
  } catch {
    throw new BrowserRuntimeError("boot_failed", "BrowserPod boot failed");
  }
  if (!pod || typeof pod.createCustomTerminal !== "function" || typeof pod.run !== "function"
    || typeof pod.onPortal !== "function" || typeof pod.createDirectory !== "function"
    || typeof pod.createFile !== "function" || typeof pod.openFile !== "function") {
    throw new BrowserRuntimeError("provider_incompatible", "BrowserPod 2.x API surface is incomplete");
  }

  const tasks = new Map();
  const portals = new Map();
  const portalListeners = new Set();
  let accepting = true;
  let taskSequence = 0;

  pod.onPortal((untrustedPortal) => {
    const portal = portalRecord(untrustedPortal);
    if (!portal) {
      safeAudit(onAudit, { action: "portal", outcome: "rejected", reason: "invalid_portal" });
      return;
    }
    portals.set(portal.port, portal);
    safeAudit(onAudit, { action: "portal", outcome: "available", port: portal.port });
    for (const listener of portalListeners) listener();
  });

  safeAudit(onAudit, {
    action: "boot",
    outcome: "ready",
    runtime: "browserpod",
    runtimeVersion: BROWSERPOD_ADAPTER_VERSION,
    persistent: Boolean(persistenceKey),
    durationMs: Math.max(0, now() - bootStartedAt)
  });

  const runtime = {
    contractVersion: BROWSER_RUNTIME_CONTRACT_VERSION,
    provider: "browserpod",
    version: BROWSERPOD_ADAPTER_VERSION,
    features: Object.freeze({
      browserLocal: true,
      nodeMajor: 22,
      persistentFilesystem: Boolean(persistenceKey),
      portals: true,
      portalVisibility: "public-url",
      fileApi: true,
      interactiveInput: false,
      processTermination: false,
      hardDispose: false
    }),

    async start(untrustedCommand) {
      if (!accepting) throw new BrowserRuntimeError("runtime_closed", "runtime no longer accepts work");
      const command = normalizeCommand(untrustedCommand);
      const id = `browserpod-task-${++taskSequence}`;
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const outputListeners = new Set();
      let transcript = "";
      let transcriptBytes = 0;
      let outputTruncated = false;
      let state = "starting";
      const startedAt = now();
      const terminal = await pod.createCustomTerminal({
        cols: command.cols,
        rows: command.rows,
        onOutput(buffer) {
          // BrowserPod 2.12.1 delivers terminal output as Uint8Array views,
          // typically backed by a SharedArrayBuffer, although its published
          // type declares ArrayBuffer; both shapes are accepted. Shared-memory
          // views must be copied before TextDecoder will decode them.
          let bytes;
          if (buffer instanceof ArrayBuffer) bytes = new Uint8Array(buffer);
          else if (ArrayBuffer.isView(buffer)) bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
          else return;
          const chunkBytes = bytes.byteLength;
          const remaining = Math.max(0, command.outputLimitBytes - transcriptBytes);
          if (remaining > 0) {
            const bounded = bytes.subarray(0, Math.min(chunkBytes, remaining));
            const copy = new Uint8Array(bounded.length);
            copy.set(bounded);
            const chunk = decoder.decode(copy, { stream: true });
            transcript += chunk;
            transcriptBytes += copy.byteLength;
            for (const listener of outputListeners) {
              try { listener(chunk); }
              catch { /* Output consumers cannot break the runtime. */ }
            }
          }
          if (chunkBytes > remaining) outputTruncated = true;
        }
      });
      state = "running";
      safeAudit(onAudit, {
        action: "start",
        outcome: "running",
        taskId: id,
        executable: command.executable,
        argCount: command.args.length,
        envCount: command.env.length
      });

      const completion = Promise.resolve()
        .then(() => pod.run(command.executable, [...command.args], {
          terminal,
          env: [...command.env],
          ...(command.cwd ? { cwd: command.cwd } : {}),
          echo: command.echo
        }))
        .then(
          () => {
            transcript += decoder.decode();
            state = "completed";
            safeAudit(onAudit, {
              action: "complete",
              outcome: "completed",
              taskId: id,
              durationMs: Math.max(0, now() - startedAt),
              outputBytes: transcriptBytes,
              outputTruncated
            });
            return Object.freeze({ status: "completed", outputBytes: transcriptBytes, outputTruncated });
          },
          () => {
            transcript += decoder.decode();
            state = "failed";
            safeAudit(onAudit, {
              action: "complete",
              outcome: "failed",
              taskId: id,
              durationMs: Math.max(0, now() - startedAt),
              outputBytes: transcriptBytes,
              outputTruncated
            });
            return Object.freeze({ status: "failed", outputBytes: transcriptBytes, outputTruncated });
          }
        );

      const task = Object.freeze({
        id,
        get status() { return state; },
        get transcript() { return transcript; },
        get outputTruncated() { return outputTruncated; },
        onOutput(listener, options = {}) {
          if (typeof listener !== "function") throw new BrowserRuntimeError("invalid_listener", "output listener is invalid");
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
            matches: (value) => value.includes(needle),
            timeoutMs: options.timeoutMs,
            signal: options.signal,
            timeoutMessage: `runtime output did not contain ${needle}`
          });
        },
        terminate() {
          throw new BrowserRuntimeError(
            "unsupported_feature",
            "BrowserPod 2.12.1 does not expose documented process termination"
          );
        }
      });
      tasks.set(id, task);
      void completion.finally(() => tasks.delete(id));
      return task;
    },

    waitForPortal(port, options = {}) {
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        throw new BrowserRuntimeError("invalid_port", "portal port is invalid");
      }
      return waitForCondition({
        current: () => portals.get(port),
        subscribe: (listener) => {
          portalListeners.add(listener);
          return () => portalListeners.delete(listener);
        },
        matches: Boolean,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        timeoutMessage: `BrowserPod portal for port ${port} was not observed`
      });
    },

    async createDirectory(path, options = {}) {
      if (!accepting) throw new BrowserRuntimeError("runtime_closed", "runtime no longer accepts work");
      assertAbsoluteGuestPath(path);
      await pod.createDirectory(path, { recursive: options.recursive === true });
    },

    async writeTextFile(path, text) {
      if (!accepting) throw new BrowserRuntimeError("runtime_closed", "runtime no longer accepts work");
      assertAbsoluteGuestPath(path);
      if (typeof text !== "string" || text.length > 16 * 1024 * 1024) {
        throw new BrowserRuntimeError("invalid_file", "guest text file is invalid");
      }
      const file = await pod.createFile(path, "utf-8");
      try { await file.write(text); }
      finally { await file.close(); }
    },

    async readTextFile(path, { maxBytes = 2 * 1024 * 1024 } = {}) {
      if (!accepting) throw new BrowserRuntimeError("runtime_closed", "runtime no longer accepts work");
      assertAbsoluteGuestPath(path);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
        throw new BrowserRuntimeError("invalid_file", "guest read limit is invalid");
      }
      const file = await pod.openFile(path, "utf-8");
      try {
        const size = await file.getSize();
        if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) {
          throw new BrowserRuntimeError("file_too_large", "guest text file exceeds the read limit");
        }
        return await file.read(size);
      } finally { await file.close(); }
    },

    dispose() {
      accepting = false;
      const activeTaskIds = [...tasks.keys()];
      safeAudit(onAudit, {
        action: "dispose",
        outcome: activeTaskIds.length === 0 ? "logical_only" : "incomplete",
        activeTaskCount: activeTaskIds.length
      });
      return Object.freeze({
        complete: false,
        reason: "BrowserPod 2.12.1 exposes no documented pod or process termination",
        activeTaskIds: Object.freeze(activeTaskIds)
      });
    }
  };
  return Object.freeze(runtime);
}
