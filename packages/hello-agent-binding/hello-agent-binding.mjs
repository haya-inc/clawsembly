// The hello-agent reference binding. It supplies everything the upstream
// binding contract requires - exact artifact identity, a boot recipe with
// deterministic readiness, a bounded protocol client whose shape mirrors the
// OpenClaw embedding surface (greeting plus chat send, history, abort), an
// explicit capability-requirement mapping, and a minimal evidence gate - by
// composing the unmodified core. The agent can do chat work only through the
// embedder-controlled capability boundary, so the binding demonstrates both
// growth paths: the fixture grows under exact-identity discipline, and the
// embedding application extends the agent by introducing host capabilities.
// Its purpose is to prove the embedding boundary does not hard-code OpenClaw
// specifics; it is not a real agent and claims no verified runtime support.
import { startCooperativeProcess } from "../browser-runtime/cooperative-process.mjs";
import { createBrowserPodRuntime } from "../browser-runtime/browserpod-runtime.mjs";
import { CapabilityBroker } from "../capability-broker/capability-broker.mjs";
import { CapabilityConsentController } from "../capability-broker/capability-consent.mjs";
import { FilesystemCapabilityMailboxHost } from "../capability-broker/filesystem-mailbox-host.mjs";
import { stageGuestMailboxClient } from "../capability-broker/guest-mailbox-artifact.mjs";
import { createArtifactStorageKey, createEmbedSessionLifecycle } from "../embed-sdk/boot.mjs";
import { assertVerifiedLaunch } from "../embed-sdk/embed-manifest.mjs";
import { HELLO_AGENT_ARTIFACT } from "./hello-agent-artifact.generated.mjs";

export const HELLO_AGENT_INSTALL_ROOT = "/workspace/.clawsembly/hello-agent";
export const HELLO_AGENT_READY_LINE = "[hello-agent] ready";

/**
 * The host capabilities this upstream needs, mapped to broker scopes. The
 * declaration derives from the pinned artifact's own protocol descriptor;
 * the embedding application places these requests into its embed manifest
 * and owns the handler, grant, revocation, and audit for each one.
 */
export const HELLO_AGENT_CAPABILITY_REQUIREMENTS = Object.freeze(
  HELLO_AGENT_ARTIFACT.capabilities.map((requirement) => Object.freeze({
    capability: requirement.capability,
    scope: requirement.scope,
    maxCalls: 16
  }))
);

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const MAILBOX_CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9-]{16,64}$/u;
const ENVIRONMENT_ENTRY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const GUEST_PATH_PATTERN = /^\/(?:[^\u0000/]+\/)*[^\u0000/]+$/u;
const MAX_PROTOCOL_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 4_096;
const MAX_EVENT_BYTES = 1_024;
const MAX_CHAT_EVENTS = 5;
const MAX_MESSAGE_CHARS = 1_024;
const MAX_REPLY_CHARS = 2_048;
const MAX_DELTA_CHARS = 512;
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_TEXT_CHARS = 96;
const CHAT_ERROR_CODES = Object.freeze([
  "invalid_request",
  "capability_unavailable",
  "capability_denied",
  "capability_failed",
  "capability_invalid_result",
  "chat_busy",
  "chat_failed"
]);
const CHAT_TRANSPORT_MODES = Object.freeze(["filesystem-mailbox", "none"]);

export class HelloAgentBindingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HelloAgentBindingError";
    this.code = code;
  }
}

export function assertExactHelloAgentArtifact(artifact) {
  if (!artifact || artifact.package !== HELLO_AGENT_ARTIFACT.name
    || typeof artifact.version !== "string" || !VERSION_PATTERN.test(artifact.version)
    || typeof artifact.integrity !== "string" || !INTEGRITY_PATTERN.test(artifact.integrity)) {
    throw new TypeError("an exact hello-agent version and sha512 integrity are required");
  }
  return Object.freeze({
    package: HELLO_AGENT_ARTIFACT.name,
    version: artifact.version,
    integrity: artifact.integrity
  });
}

function assertGuestRoot(value, label) {
  if (typeof value !== "string" || value.length > 4_096 || !GUEST_PATH_PATTERN.test(value)
    || value.split("/").slice(1).some((segment) => segment === "." || segment === "..")) {
    throw new TypeError(`${label} must be an absolute normalized guest path`);
  }
  return value;
}

function safeSink(sink, value) {
  try { sink?.(Object.freeze(value)); }
  catch { /* Diagnostics cannot break the binding. */ }
}

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function containsControlCharacters(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint < 32 || codePoint === 127;
  });
}

function printableText(value, maxChars) {
  return typeof value === "string" && value.length >= 1 && value.length <= maxChars
    && !containsControlCharacters(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/**
 * Stages the exact hello-agent artifact into a runtime filesystem and
 * verifies every staged file against the generated per-file digests before
 * exposing its executable path. The recipe differs from the OpenClaw npm
 * install on purpose: each binding owns its install procedure; the contract
 * only demands exact-identity verification before anything executes.
 */
export function createVerifiedHelloAgentInstaller({
  runtime,
  artifact: untrustedArtifact,
  root = HELLO_AGENT_INSTALL_ROOT,
  onAudit,
  now = Date.now
}) {
  if (!runtime || typeof runtime.createDirectory !== "function"
    || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function") {
    throw new TypeError("a browser runtime is required for hello-agent installation");
  }
  const artifact = assertExactHelloAgentArtifact(untrustedArtifact);
  const installRoot = assertGuestRoot(root, "hello-agent install root");
  if (typeof onAudit !== "undefined" && typeof onAudit !== "function") {
    throw new TypeError("hello-agent install audit sink is invalid");
  }
  if (typeof now !== "function") throw new TypeError("hello-agent install clock is invalid");

  const stateRoot = `${installRoot}/state`;
  const packageRoot = `${installRoot}/node_modules/${HELLO_AGENT_ARTIFACT.name}`;
  const executablePath = `${packageRoot}/${HELLO_AGENT_ARTIFACT.entrypoint}`;
  const protocolPath = `${packageRoot}/${HELLO_AGENT_ARTIFACT.protocolFile}`;
  const installRecordPath = `${installRoot}/install-record.json`;
  let state = "idle";
  let result;
  let inFlight;

  async function performInstall() {
    const startedAt = now();
    safeSink(onAudit, {
      action: "install",
      outcome: "started",
      package: HELLO_AGENT_ARTIFACT.name,
      version: artifact.version
    });
    if (artifact.version !== HELLO_AGENT_ARTIFACT.version
      || artifact.integrity !== HELLO_AGENT_ARTIFACT.integrity) {
      throw new HelloAgentBindingError(
        "artifact_mismatch",
        "the requested artifact does not match the generated hello-agent version and integrity"
      );
    }
    await runtime.createDirectory(packageRoot, { recursive: true });
    await runtime.createDirectory(stateRoot, { recursive: true });

    const stagedFiles = [];
    for (const file of HELLO_AGENT_ARTIFACT.files) {
      if (await sha256Hex(file.contents) !== file.sha256) {
        throw new HelloAgentBindingError(
          "artifact_corrupt",
          `generated hello-agent artifact is corrupt: ${file.relativePath}`
        );
      }
      const path = `${packageRoot}/${file.relativePath}`;
      await runtime.writeTextFile(path, file.contents);
      const observed = await runtime.readTextFile(path, { maxBytes: file.bytes + 1 });
      if (observed !== file.contents) {
        throw new HelloAgentBindingError(
          "staging_verification_failed",
          `hello-agent staging verification failed for ${file.relativePath}`
        );
      }
      stagedFiles.push(Object.freeze({
        path,
        relativePath: file.relativePath,
        bytes: file.bytes,
        sha256: file.sha256
      }));
    }
    await runtime.writeTextFile(installRecordPath, `${JSON.stringify({
      schemaVersion: 1,
      artifact,
      tarballIntegrity: HELLO_AGENT_ARTIFACT.integrity,
      fileCount: stagedFiles.length,
      files: stagedFiles.map(({ relativePath, bytes, sha256 }) => ({ relativePath, bytes, sha256 }))
    }, null, 2)}\n`);

    const installed = Object.freeze({
      schemaVersion: 1,
      artifact,
      root: installRoot,
      stateRoot,
      packageRoot,
      executablePath,
      protocolPath,
      installRecordPath,
      fileCount: stagedFiles.length,
      files: Object.freeze(stagedFiles),
      durationMs: Math.max(0, now() - startedAt),
      integrityMatched: true
    });
    safeSink(onAudit, {
      action: "install",
      outcome: "verified",
      package: HELLO_AGENT_ARTIFACT.name,
      version: artifact.version,
      fileCount: installed.fileCount,
      durationMs: installed.durationMs
    });
    return installed;
  }

  const installer = {
    schemaVersion: 1,
    artifact,
    root: installRoot,
    stateRoot,
    executablePath,
    protocolPath,
    get state() { return state; },
    install() {
      if (state === "installed") return Promise.resolve(result);
      if (state === "installing") return inFlight;
      state = "installing";
      inFlight = performInstall().then(
        (installed) => {
          result = installed;
          state = "installed";
          return installed;
        },
        (error) => {
          state = "failed";
          safeSink(onAudit, {
            action: "install",
            outcome: "failed",
            package: HELLO_AGENT_ARTIFACT.name,
            version: artifact.version,
            reason: error instanceof HelloAgentBindingError ? error.code : "install_failed"
          });
          throw error;
        }
      );
      return inFlight;
    }
  };
  return Object.freeze(installer);
}

/**
 * Boots the staged hello-agent through the generic cooperative guest
 * supervisor and requires both deterministic readiness signals - the ready
 * log line and a parseable ready.json session record - before exposing the
 * session. Shutdown is the nonce-bound cooperative stop; there is no
 * provider-specific termination dependency.
 */
export function createVerifiedHelloAgentProcess({
  runtime,
  installer,
  graceMs = 5_000,
  readyTimeoutMs = 10_000,
  pollIntervalMs = 50,
  environment = [],
  nonceFactory,
  onOutput,
  onAudit,
  now = Date.now
}) {
  if (!runtime || typeof runtime.start !== "function" || typeof runtime.readTextFile !== "function"
    || typeof runtime.createDirectory !== "function") {
    throw new TypeError("a browser runtime is required for the hello-agent process");
  }
  if (!installer || installer.schemaVersion !== 1 || typeof installer.install !== "function") {
    throw new TypeError("a verified hello-agent installer is required");
  }
  if (typeof onOutput !== "undefined" && typeof onOutput !== "function") {
    throw new TypeError("hello-agent output sink is invalid");
  }
  if (typeof onAudit !== "undefined" && typeof onAudit !== "function") {
    throw new TypeError("hello-agent audit sink is invalid");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 5_000) {
    throw new TypeError("hello-agent poll interval is invalid");
  }
  if (!Array.isArray(environment) || environment.length > 64
    || environment.some((entry) => typeof entry !== "string" || entry.length > 4_096
      || !ENVIRONMENT_ENTRY_PATTERN.test(entry) || entry.includes("\0"))) {
    throw new TypeError("hello-agent process environment is invalid");
  }
  if (typeof now !== "function") throw new TypeError("hello-agent process clock is invalid");

  const artifact = installer.artifact;
  let state = "idle";
  let supervised;
  let session;
  let sessionToken;
  let readiness;
  let lastStop;

  async function readReadyRecord(sessionRoot, deadline) {
    while (now() < deadline) {
      try {
        const record = JSON.parse(await runtime.readTextFile(`${sessionRoot}/ready.json`, {
          maxBytes: MAX_RESPONSE_BYTES
        }));
        if (record?.schemaVersion === 1 && record.protocol === HELLO_AGENT_ARTIFACT.protocol
          && typeof record.sessionToken === "string" && SESSION_TOKEN_PATTERN.test(record.sessionToken)
          && CHAT_TRANSPORT_MODES.includes(record.capabilityTransport)
          && Number.isFinite(Date.parse(record.startedAt))) {
          return record;
        }
      } catch { /* The guest may still be writing its session record. */ }
      await delay(pollIntervalMs);
    }
    throw new HelloAgentBindingError("readiness_failed", "hello-agent did not publish a valid session record");
  }

  const helloProcess = {
    schemaVersion: 1,
    artifact,
    get state() { return state; },
    get task() { return supervised?.task; },
    get readiness() { return readiness; },
    get session() { return session; },
    credentials() {
      if (state !== "ready") {
        throw new HelloAgentBindingError("hello_not_ready", "hello-agent session credentials require readiness");
      }
      return Object.freeze({ sessionToken });
    },
    async start() {
      if (state !== "idle") {
        throw new HelloAgentBindingError("invalid_state", "hello-agent process can only start once");
      }
      state = "starting";
      safeSink(onAudit, { action: "start", outcome: "started", package: artifact.package, version: artifact.version });
      try {
        const installed = await installer.install();
        const sessionRoot = `${installed.stateRoot}/session`;
        await runtime.createDirectory(sessionRoot, { recursive: true });
        supervised = await startCooperativeProcess({
          runtime,
          root: installed.stateRoot,
          id: "hello-agent",
          command: {
            executable: "node",
            args: [installed.executablePath, sessionRoot],
            cwd: installed.root,
            env: [...environment]
          },
          graceMs,
          readyTimeoutMs,
          ...(nonceFactory === undefined ? {} : { nonceFactory })
        });
        if (onOutput) {
          supervised.task.onOutput((chunk) => safeSink(onOutput, { phase: "hello-agent", chunk }));
        }
        const startedAt = now();
        await supervised.task.waitForOutput(HELLO_AGENT_READY_LINE, { timeoutMs: readyTimeoutMs });
        const record = await readReadyRecord(sessionRoot, startedAt + readyTimeoutMs);
        sessionToken = record.sessionToken;
        session = Object.freeze({
          root: sessionRoot,
          requestsRoot: `${sessionRoot}/requests`,
          responsesRoot: `${sessionRoot}/responses`,
          eventsRoot: `${sessionRoot}/events`,
          protocolPath: installed.protocolPath,
          protocol: record.protocol,
          capabilityTransport: record.capabilityTransport,
          startedAt: record.startedAt
        });
        readiness = Object.freeze({
          output: true,
          readyFile: true,
          protocol: record.protocol,
          capabilityTransport: record.capabilityTransport
        });
        state = "ready";
        safeSink(onAudit, {
          action: "start",
          outcome: "ready",
          package: artifact.package,
          version: artifact.version,
          taskId: supervised.task.id
        });
        return readiness;
      } catch (error) {
        state = "failed";
        safeSink(onAudit, {
          action: "start",
          outcome: "failed",
          package: artifact.package,
          version: artifact.version,
          reason: error instanceof HelloAgentBindingError ? error.code : "start_failed"
        });
        throw error;
      }
    },
    async stop(options = {}) {
      if (state === "stopped" && lastStop) return lastStop;
      if (!supervised || !["ready", "starting", "stopping", "failed"].includes(state)) {
        return Object.freeze({
          complete: false,
          mode: "guest-supervisor",
          reason: "hello-agent process has not started",
          taskId: null
        });
      }
      state = "stopping";
      const stopResult = await supervised.stop(options);
      state = stopResult.complete ? "stopped" : "failed";
      lastStop = stopResult;
      safeSink(onAudit, {
        action: "stop",
        outcome: stopResult.complete ? "stopped" : "failed",
        package: artifact.package,
        version: artifact.version,
        taskId: stopResult.taskId
      });
      return stopResult;
    }
  };
  return Object.freeze(helloProcess);
}

/**
 * The bounded protocol client. It exposes the four artifact-declared methods
 * — hello.say plus the chat.send / chat.history / chat.abort chat surface —
 * verifies the installed protocol descriptor against the generated pin
 * before the first request, presents the guest-minted session token on
 * every request, and holds that token in memory only.
 */
export function createHelloAgentClient({
  runtime,
  process: helloProcess,
  requestIdFactory = () => globalThis.crypto.randomUUID(),
  timeoutMs = 5_000,
  pollIntervalMs = 50,
  onAudit,
  now = Date.now
}) {
  if (!runtime || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function") {
    throw new TypeError("a browser runtime is required for the hello-agent client");
  }
  if (!helloProcess || helloProcess.schemaVersion !== 1 || typeof helloProcess.credentials !== "function") {
    throw new TypeError("a verified hello-agent process is required");
  }
  if (typeof requestIdFactory !== "function") throw new TypeError("hello-agent request id factory is invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new TypeError("hello-agent client timeout is invalid");
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 5_000) {
    throw new TypeError("hello-agent client poll interval is invalid");
  }
  if (typeof onAudit !== "undefined" && typeof onAudit !== "function") {
    throw new TypeError("hello-agent client audit sink is invalid");
  }
  if (typeof now !== "function") throw new TypeError("hello-agent client clock is invalid");

  let closed = false;
  let requestCount = 0;
  let contractVerified = false;

  async function verifyProtocolPin() {
    const protocolText = await runtime.readTextFile(
      helloProcess.session.protocolPath,
      { maxBytes: MAX_PROTOCOL_BYTES }
    );
    if (await sha256Hex(protocolText) !== HELLO_AGENT_ARTIFACT.protocolSha256) {
      throw new HelloAgentBindingError(
        "protocol_drift",
        "installed hello-agent protocol descriptor does not match the generated pin"
      );
    }
    const descriptor = JSON.parse(protocolText);
    const methodNames = Array.isArray(descriptor?.methods)
      ? descriptor.methods.map((method) => method?.name)
      : [];
    if (descriptor?.protocol !== HELLO_AGENT_ARTIFACT.protocol
      || JSON.stringify(methodNames) !== JSON.stringify([...HELLO_AGENT_ARTIFACT.methods])) {
      throw new HelloAgentBindingError("protocol_drift", "hello-agent protocol descriptor is invalid");
    }
    contractVerified = true;
    safeSink(onAudit, { action: "protocol", outcome: "verified", package: helloProcess.artifact.package });
  }

  function assertOpen() {
    if (closed) throw new HelloAgentBindingError("client_closed", "hello-agent client is closed");
    if (helloProcess.state !== "ready") {
      throw new HelloAgentBindingError("hello_not_ready", "hello-agent process is not ready");
    }
  }

  async function submitRequest(method, params) {
    if (!contractVerified) await verifyProtocolPin();
    const id = requestIdFactory();
    if (typeof id !== "string" || !REQUEST_ID_PATTERN.test(id)) {
      throw new HelloAgentBindingError("invalid_request_id", "hello-agent request identifier is invalid");
    }
    await runtime.writeTextFile(
      `${helloProcess.session.requestsRoot}/request-${id}.json`,
      JSON.stringify({
        schemaVersion: 1,
        id,
        method,
        sessionToken: helloProcess.credentials().sessionToken,
        params
      })
    );
    requestCount += 1;
    return id;
  }

  async function readResponseOnce(id) {
    let response;
    try {
      response = JSON.parse(await runtime.readTextFile(
        `${helloProcess.session.responsesRoot}/response-${id}.json`,
        { maxBytes: MAX_RESPONSE_BYTES }
      ));
    } catch {
      return undefined;
    }
    if (response?.schemaVersion !== 1 || response.id !== id
      || (response.ok !== true && response.ok !== false)) {
      throw new HelloAgentBindingError("response_invalid", "hello-agent response envelope is invalid");
    }
    return response;
  }

  async function readResponse(id, deadline) {
    while (now() < deadline) {
      const response = await readResponseOnce(id);
      if (response !== undefined) return response;
      await delay(pollIntervalMs);
    }
    return undefined;
  }

  // One non-blocking attempt to read the turn's next stream event. Sequence
  // numbers must stay contiguous and bounded, delta text bounded and
  // printable, and a done event terminal. Any other shape fails closed.
  async function readChatEvent(id, sequence) {
    const path = `${helloProcess.session.eventsRoot}/${id}/event-${String(sequence).padStart(8, "0")}.json`;
    let event;
    try {
      event = JSON.parse(await runtime.readTextFile(path, { maxBytes: MAX_EVENT_BYTES }));
    } catch {
      return undefined;
    }
    if (sequence > MAX_CHAT_EVENTS || event?.schemaVersion !== 1
      || event.id !== id || event.sequence !== sequence) {
      throw new HelloAgentBindingError("stream_invalid", "hello-agent chat stream is invalid");
    }
    if (event.kind === "delta") {
      if (!exactKeys(event, ["schemaVersion", "id", "sequence", "kind", "text"])
        || !printableText(event.text, MAX_DELTA_CHARS)) {
        throw new HelloAgentBindingError("stream_invalid", "hello-agent chat delta is invalid");
      }
      return event;
    }
    if (event.kind === "done") {
      const doneKeys = ["schemaVersion", "id", "sequence", "kind", "reason"];
      if ((!exactKeys(event, doneKeys) && !exactKeys(event, [...doneKeys, "code"]))
        || typeof event.reason !== "string" || event.reason.length > 64
        || (event.code !== undefined && !CHAT_ERROR_CODES.includes(event.code))) {
        throw new HelloAgentBindingError("stream_invalid", "hello-agent chat stream is invalid");
      }
      return event;
    }
    throw new HelloAgentBindingError("stream_invalid", "hello-agent chat stream is invalid");
  }

  const client = {
    artifact: helloProcess.artifact,
    get requestCount() { return requestCount; },
    get closed() { return closed; },
    async say({ name } = {}) {
      const startedAt = now();
      assertOpen();
      if (typeof name !== "string" || name.length < 1 || name.length > 64
        || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw new HelloAgentBindingError("invalid_params", "hello-agent greeting name is invalid");
      }
      const id = await submitRequest("hello.say", { name });
      const response = await readResponse(id, startedAt + timeoutMs);
      if (response === undefined) {
        safeSink(onAudit, { action: "say", outcome: "timeout", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError("response_timeout", "hello-agent did not answer before the deadline");
      }
      if (response.ok !== true) {
        const code = response?.error?.code === "invalid_request" ? "invalid_request" : "response_invalid";
        safeSink(onAudit, { action: "say", outcome: "rejected", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError(code, "hello-agent rejected the request");
      }
      if (typeof response.result?.greeting !== "string" || response.result.greeting.length > 256) {
        throw new HelloAgentBindingError("response_invalid", "hello-agent greeting is invalid");
      }
      safeSink(onAudit, { action: "say", outcome: "ok", requestId: id, durationMs: Math.max(0, now() - startedAt) });
      return Object.freeze({ greeting: response.result.greeting });
    },
    /**
     * Starts one chat turn and returns its request identifier plus a
     * completion promise. The identifier can be passed to abortChat while
     * the turn is in flight. A completed turn always crossed the host
     * capability boundary; the agent has no other way to produce a reply.
     */
    async startChat({ message } = {}) {
      const startedAt = now();
      assertOpen();
      if (!printableText(message, MAX_MESSAGE_CHARS)) {
        throw new HelloAgentBindingError("invalid_params", "hello-agent chat message is invalid");
      }
      const id = await submitRequest("chat.send", { message });
      const deadline = startedAt + timeoutMs;
      // Events and the final response are polled together: a rejected turn
      // (invalid, unavailable, busy) answers without ever opening a stream,
      // while an executed turn streams deltas and a done event first.
      const completion = (async () => {
        const deltas = [];
        let consumed = 0;
        let done;
        while (now() < deadline) {
          if (done === undefined) {
            const event = await readChatEvent(id, consumed + 1);
            if (event !== undefined) {
              consumed += 1;
              if (event.kind === "delta") deltas.push(event.text);
              else done = event;
              continue;
            }
          }
          const response = await readResponseOnce(id);
          if (response === undefined) {
            await delay(pollIntervalMs);
            continue;
          }
          if (response.ok !== true) {
            const code = CHAT_ERROR_CODES.includes(response?.error?.code)
              ? response.error.code
              : "response_invalid";
            if (done !== undefined
              && (done.reason !== "failed" || done.code !== code || deltas.length !== 0)) {
              throw new HelloAgentBindingError("stream_invalid", "hello-agent chat stream is invalid");
            }
            safeSink(onAudit, {
              action: "chat",
              outcome: "rejected",
              requestId: id,
              reason: code,
              durationMs: Math.max(0, now() - startedAt)
            });
            throw new HelloAgentBindingError(code, "hello-agent rejected the chat turn");
          }
          if (done === undefined || !exactKeys(response.result, ["reply", "reason", "events"])
            || response.result.events !== consumed
            || response.result.reason !== done.reason) {
            throw new HelloAgentBindingError("response_invalid", "hello-agent chat result is invalid");
          }
          if (response.result.reason === "completed") {
            const reply = deltas.join("");
            if (response.result.reply !== reply || !printableText(reply, MAX_REPLY_CHARS)) {
              throw new HelloAgentBindingError("response_invalid", "hello-agent chat result is invalid");
            }
            safeSink(onAudit, {
              action: "chat",
              outcome: "ok",
              requestId: id,
              events: consumed,
              durationMs: Math.max(0, now() - startedAt)
            });
            return Object.freeze({ id, reply, reason: "completed", events: consumed });
          }
          if (response.result.reason === "aborted") {
            if (response.result.reply !== null || deltas.length !== 0) {
              throw new HelloAgentBindingError("response_invalid", "hello-agent chat result is invalid");
            }
            safeSink(onAudit, {
              action: "chat",
              outcome: "aborted",
              requestId: id,
              durationMs: Math.max(0, now() - startedAt)
            });
            return Object.freeze({ id, reply: null, reason: "aborted", events: consumed });
          }
          throw new HelloAgentBindingError("response_invalid", "hello-agent chat result is invalid");
        }
        safeSink(onAudit, { action: "chat", outcome: "timeout", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError("response_timeout", "hello-agent did not finish the chat turn before the deadline");
      })();
      return Object.freeze({ id, completion });
    },
    async abortChat({ target } = {}) {
      const startedAt = now();
      assertOpen();
      if (typeof target !== "string" || !REQUEST_ID_PATTERN.test(target)) {
        throw new HelloAgentBindingError("invalid_params", "hello-agent abort target is invalid");
      }
      const id = await submitRequest("chat.abort", { target });
      const response = await readResponse(id, startedAt + timeoutMs);
      if (response === undefined) {
        safeSink(onAudit, { action: "abort", outcome: "timeout", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError("response_timeout", "hello-agent did not answer before the deadline");
      }
      if (response.ok !== true || !exactKeys(response.result, ["aborted"])
        || typeof response.result.aborted !== "boolean") {
        safeSink(onAudit, { action: "abort", outcome: "rejected", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError("response_invalid", "hello-agent abort result is invalid");
      }
      safeSink(onAudit, {
        action: "abort",
        outcome: "ok",
        requestId: id,
        aborted: response.result.aborted,
        durationMs: Math.max(0, now() - startedAt)
      });
      return Object.freeze({ aborted: response.result.aborted });
    },
    async chatHistory() {
      const startedAt = now();
      assertOpen();
      const id = await submitRequest("chat.history", {});
      const response = await readResponse(id, startedAt + timeoutMs);
      if (response === undefined) {
        safeSink(onAudit, { action: "history", outcome: "timeout", requestId: id, durationMs: Math.max(0, now() - startedAt) });
        throw new HelloAgentBindingError("response_timeout", "hello-agent did not answer before the deadline");
      }
      if (response.ok !== true || !exactKeys(response.result, ["turns", "total"])
        || !Array.isArray(response.result.turns) || response.result.turns.length > MAX_HISTORY_TURNS
        || !Number.isSafeInteger(response.result.total)
        || response.result.total < response.result.turns.length) {
        throw new HelloAgentBindingError("response_invalid", "hello-agent history is invalid");
      }
      const turns = response.result.turns.map((turn) => {
        if (!exactKeys(turn, ["id", "at", "message", "reply", "reason"])
          || typeof turn.id !== "string" || !REQUEST_ID_PATTERN.test(turn.id)
          || !Number.isFinite(Date.parse(turn.at))
          || !printableText(turn.message, MAX_HISTORY_TEXT_CHARS)
          || (turn.reply !== null && !printableText(turn.reply, MAX_HISTORY_TEXT_CHARS))
          || typeof turn.reason !== "string" || turn.reason.length > 64) {
          throw new HelloAgentBindingError("response_invalid", "hello-agent history is invalid");
        }
        return Object.freeze({ ...turn });
      });
      safeSink(onAudit, {
        action: "history",
        outcome: "ok",
        requestId: id,
        turns: turns.length,
        durationMs: Math.max(0, now() - startedAt)
      });
      return Object.freeze({ turns: Object.freeze(turns), total: response.result.total });
    },
    close() { closed = true; }
  };
  return Object.freeze(client);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

/**
 * The minimal evidence gate. Evidence passes only when it binds the exact
 * generated artifact identity, a verified staging result, both readiness
 * signals, at least one completed hello round trip and one chat round trip,
 * a capability-boundary crossing with at least one denied and one allowed
 * outcome for the declared requirement, and an acknowledged cooperative
 * shutdown. Anything else fails closed.
 */
export function assertHelloAgentRuntimeEvidence(evidence) {
  const failures = [];
  if (evidence?.schemaVersion !== 1 || !Number.isFinite(Date.parse(evidence?.capturedAt))) failures.push("identity");
  if (evidence?.target?.runtime !== "browserpod" || evidence?.target?.browserLocal !== true
    || typeof evidence?.target?.runtimeVersion !== "string" || typeof evidence?.target?.browser !== "string") {
    failures.push("target");
  }
  if (evidence?.artifact?.package !== HELLO_AGENT_ARTIFACT.name
    || evidence?.artifact?.version !== HELLO_AGENT_ARTIFACT.version
    || evidence?.artifact?.integrity !== HELLO_AGENT_ARTIFACT.integrity) failures.push("artifact identity");
  if (evidence?.install?.result !== "pass" || evidence?.install?.integrityMatched !== true
    || evidence?.install?.fileCount !== HELLO_AGENT_ARTIFACT.files.length
    || !Number.isFinite(evidence?.install?.durationMs)) failures.push("install integrity");
  if (evidence?.process?.result !== "pass"
    || evidence?.process?.readiness?.output !== true || evidence?.process?.readiness?.readyFile !== true
    || evidence?.process?.readiness?.protocol !== HELLO_AGENT_ARTIFACT.protocol
    || evidence?.process?.readiness?.capabilityTransport !== "filesystem-mailbox"
    || evidence?.process?.termination?.mode !== "guest-supervisor"
    || evidence?.process?.termination?.result !== "pass") failures.push("process readiness");
  if (!Array.isArray(evidence?.protocol?.methods)
    || JSON.stringify(evidence.protocol.methods) !== JSON.stringify([...HELLO_AGENT_ARTIFACT.methods])
    || !Number.isSafeInteger(evidence?.protocol?.helloRoundTrips)
    || evidence?.protocol?.helloRoundTrips < 1
    || !Number.isSafeInteger(evidence?.protocol?.chatRoundTrips)
    || evidence?.protocol?.chatRoundTrips < 1) failures.push("protocol round trips");
  const requirement = HELLO_AGENT_CAPABILITY_REQUIREMENTS[0];
  if (evidence?.capability?.capability !== requirement.capability
    || evidence?.capability?.scope !== requirement.scope
    || !Number.isSafeInteger(evidence?.capability?.denied) || evidence?.capability?.denied < 1
    || !Number.isSafeInteger(evidence?.capability?.allowed) || evidence?.capability?.allowed < 1) {
    failures.push("capability boundary");
  }
  if (failures.length) throw new Error(`Invalid hello-agent evidence: ${failures.join(", ")}`);
  return evidence;
}

/**
 * Digest-bound evidence reference, mirroring the report pipeline's evidence
 * entries: the SHA-256 covers the canonicalized record, so any tampering
 * with a stored record is detectable against this reference.
 */
export async function helloAgentEvidenceRecord(evidence) {
  assertHelloAgentRuntimeEvidence(evidence);
  return Object.freeze({
    id: "hello-agent-runtime",
    kind: "browser-runtime",
    capturedAt: evidence.capturedAt,
    path: `evidence/hello-agent-${evidence.artifact.version}.json`,
    sha256: await sha256Hex(JSON.stringify(canonicalize(evidence))),
    summary: `The exact ${evidence.artifact.package} ${evidence.artifact.version} artifact staged with verified per-file digests, reached both readiness signals with a live capability mailbox, answered hello.say ${evidence.protocol.helloRoundTrips} time(s), completed ${evidence.protocol.chatRoundTrips} capability-mediated chat turn(s) across the default-deny boundary (${evidence.capability.denied} denied, ${evidence.capability.allowed} allowed), and completed guest-supervisor shutdown in ${evidence.target.browser}.`
  });
}

/** Check derivations for the minimal gate: pending without valid evidence. */
export function deriveHelloAgentCheckStatuses(evidence) {
  let valid = false;
  if (evidence !== undefined) {
    try {
      assertHelloAgentRuntimeEvidence(evidence);
      valid = true;
    } catch { valid = false; }
  }
  const status = valid ? "pass" : "pending";
  return Object.freeze({
    "hello-agent-install": status,
    "hello-agent-boot": status,
    "hello-agent-protocol": status,
    "hello-agent-capability": status
  });
}

/**
 * Boots an evidence-bound session for the hello-agent binding by composing
 * the unmodified core: the fail-closed launch assertion, the BrowserPod
 * runtime adapter, the default-deny capability broker, the consent
 * controller, and the shared session lifecycle. This composition is the
 * proof that a second upstream assembles from the same parts.
 */
export async function bootHelloAgentEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  workspaceId,
  installRoot = HELLO_AGENT_INSTALL_ROOT,
  capabilityHandlers = {},
  sessionId = globalThis.crypto.randomUUID(),
  mailboxChannelId = `mailbox_${globalThis.crypto.randomUUID().replaceAll("-", "")}`,
  mailboxRoot,
  mailboxOptions = {},
  onRuntimeAudit,
  onInstallAudit,
  onProcessOutput,
  onProcessAudit,
  onCapabilityAudit,
  onPermissionAudit,
  processOptions = {}
}) {
  const verifiedManifest = assertVerifiedLaunch(manifest);
  if (verifiedManifest.artifact.package !== HELLO_AGENT_ARTIFACT.name) {
    throw new TypeError("bootHelloAgentEmbed wires the hello-agent reference binding; another upstream artifact requires its own binding boot path");
  }
  if (typeof sessionId !== "string" || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new TypeError("embed session identifier is invalid");
  }
  if (!processOptions || typeof processOptions !== "object" || Array.isArray(processOptions)) {
    throw new TypeError("hello-agent process options are invalid");
  }
  const allowedProcessOptions = new Set(["graceMs", "readyTimeoutMs", "pollIntervalMs", "nonceFactory"]);
  if (Object.keys(processOptions).some((key) => !allowedProcessOptions.has(key))) {
    throw new TypeError("hello-agent process options contain an unknown field");
  }
  assertGuestRoot(installRoot, "hello-agent install root");
  if (typeof mailboxChannelId !== "string" || !MAILBOX_CHANNEL_PATTERN.test(mailboxChannelId)) {
    throw new TypeError("hello-agent mailbox channel identifier is invalid");
  }
  if (!mailboxOptions || typeof mailboxOptions !== "object" || Array.isArray(mailboxOptions)) {
    throw new TypeError("hello-agent mailbox options are invalid");
  }
  const allowedMailboxOptions = new Set([
    "pollIntervalMs",
    "maxRequestBytes",
    "maxResponseBytes",
    "maxRequests",
    "clock"
  ]);
  if (Object.keys(mailboxOptions).some((key) => !allowedMailboxOptions.has(key))) {
    throw new TypeError("hello-agent mailbox options contain an unknown field");
  }
  const resolvedMailboxRoot = mailboxRoot ?? `${installRoot}/mailbox/${mailboxChannelId}`;
  assertGuestRoot(resolvedMailboxRoot, "hello-agent mailbox root");

  const storageKey = workspaceId === undefined
    ? undefined
    : createArtifactStorageKey(verifiedManifest, workspaceId);
  const runtime = await createBrowserPodRuntime({
    BrowserPod,
    apiKey: browserPodApiKey,
    storageKey,
    onAudit: onRuntimeAudit
  });
  const capabilities = new CapabilityBroker({
    subject: {
      artifact: verifiedManifest.artifact,
      runtime: "browserpod",
      sessionId
    },
    handlers: capabilityHandlers,
    auditSink: onCapabilityAudit
  });
  const permissions = new CapabilityConsentController({
    broker: capabilities,
    requests: verifiedManifest.capabilities,
    auditSink: onPermissionAudit
  });
  const mailbox = new FilesystemCapabilityMailboxHost({
    runtime,
    broker: capabilities,
    root: resolvedMailboxRoot,
    channelId: mailboxChannelId,
    ...(mailboxOptions.pollIntervalMs === undefined ? {} : { pollIntervalMs: mailboxOptions.pollIntervalMs }),
    ...(mailboxOptions.maxRequestBytes === undefined ? {} : { maxRequestBytes: mailboxOptions.maxRequestBytes }),
    ...(mailboxOptions.maxResponseBytes === undefined ? {} : { maxResponseBytes: mailboxOptions.maxResponseBytes }),
    ...(mailboxOptions.maxRequests === undefined ? {} : { maxRequests: mailboxOptions.maxRequests }),
    ...(mailboxOptions.clock === undefined ? {} : { clock: mailboxOptions.clock })
  });
  await mailbox.initialize();
  const guestClient = await stageGuestMailboxClient({
    runtime,
    root: `${resolvedMailboxRoot}/guest-client-v1`
  });
  const guestTransport = Object.freeze({
    schemaVersion: 1,
    kind: "filesystem-mailbox",
    channelId: mailboxChannelId,
    mailboxRoot: resolvedMailboxRoot,
    client: guestClient,
    environment: Object.freeze([
      `CLAWSEMBLY_MAILBOX_ROOT=${resolvedMailboxRoot}`,
      `CLAWSEMBLY_MAILBOX_CHANNEL=${mailboxChannelId}`,
      `CLAWSEMBLY_MAILBOX_CLIENT=${guestClient.entrypointPath}`
    ])
  });
  const installer = createVerifiedHelloAgentInstaller({
    runtime,
    artifact: verifiedManifest.artifact,
    root: installRoot,
    onAudit: onInstallAudit
  });
  const helloProcess = createVerifiedHelloAgentProcess({
    runtime,
    installer,
    environment: guestTransport.environment,
    onOutput: onProcessOutput,
    onAudit: onProcessAudit,
    ...processOptions
  });
  const protocolClients = new Set();
  const lifecycle = createEmbedSessionLifecycle({
    runtime,
    gateway: helloProcess,
    closeConnections() {
      for (const client of protocolClients) client.close();
      protocolClients.clear();
    }
  });
  return Object.freeze({
    schemaVersion: 1,
    manifest: verifiedManifest,
    runtime,
    installer,
    process: helloProcess,
    capabilities,
    permissions,
    mailbox,
    guestTransport,
    createClient(options = {}) {
      if (!options || typeof options !== "object" || Array.isArray(options)) {
        throw new TypeError("hello-agent client options are invalid");
      }
      const allowed = new Set(["requestIdFactory", "timeoutMs", "pollIntervalMs", "onAudit", "now"]);
      if (Object.keys(options).some((key) => !allowed.has(key))) {
        throw new TypeError("hello-agent client options contain an unknown field");
      }
      const client = createHelloAgentClient({ runtime, process: helloProcess, ...options });
      protocolClients.add(client);
      return client;
    },
    get closed() { return lifecycle.closed; },
    dispose() { return lifecycle.dispose(); },
    close() { return lifecycle.close(); }
  });
}
