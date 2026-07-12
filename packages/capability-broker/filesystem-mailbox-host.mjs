import { CapabilityBrokerError } from "./capability-broker.mjs";
import {
  DEFAULT_MAILBOX_MAX_BYTES,
  MailboxProtocolError,
  createMailboxManifest,
  createMailboxResponse,
  mailboxPaths,
  parseMailboxRequest,
  serializeMailboxValue
} from "./mailbox-protocol.mjs";

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  invalid_request: "capability request is invalid",
  replay_rejected: "capability request replay was rejected",
  not_granted: "capability is not granted for this scope",
  grant_expired: "capability grant has expired",
  call_limit_exhausted: "capability call limit is exhausted",
  handler_unavailable: "capability handler is unavailable",
  handler_failed: "capability handler failed",
  cancelled: "capability request was cancelled",
  response_too_large: "capability response exceeds the transport limit",
  transport_failed: "capability transport failed"
});

function validateRuntime(runtime) {
  if (!runtime || runtime.provider !== "browserpod" || typeof runtime.createDirectory !== "function"
    || typeof runtime.writeTextFile !== "function" || typeof runtime.readTextFile !== "function") {
    throw new TypeError("a BrowserPod filesystem runtime is required");
  }
  return runtime;
}

function validateBroker(broker) {
  if (!broker || typeof broker.request !== "function" || !broker.subject) {
    throw new TypeError("a capability broker is required");
  }
  return broker;
}

function validateTiming({ pollIntervalMs, maxRequests, clock }) {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 5_000) {
    throw new TypeError("mailbox poll interval is invalid");
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 10_000) {
    throw new TypeError("mailbox request limit is invalid");
  }
  if (typeof clock !== "function") throw new TypeError("mailbox clock is invalid");
}

function publicError(code) {
  const safeCode = Object.hasOwn(PUBLIC_ERROR_MESSAGES, code) ? code : "transport_failed";
  return Object.freeze({ code: safeCode, message: PUBLIC_ERROR_MESSAGES[safeCode] });
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.reject(new MailboxHostError("cancelled", "mailbox wait was cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new MailboxHostError("cancelled", "mailbox wait was cancelled"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class MailboxHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MailboxHostError";
    this.code = code;
  }
}

export class FilesystemCapabilityMailboxHost {
  #runtime;
  #broker;
  #root;
  #channelId;
  #pollIntervalMs;
  #maxRequestBytes;
  #maxResponseBytes;
  #maxRequests;
  #clock;
  #nextSequence = 1;
  #seenIds = new Set();
  #initialized = false;
  #events = [];

  constructor({
    runtime,
    broker,
    root,
    channelId,
    pollIntervalMs = 50,
    maxRequestBytes = DEFAULT_MAILBOX_MAX_BYTES,
    maxResponseBytes = DEFAULT_MAILBOX_MAX_BYTES,
    maxRequests = 1_000,
    clock = Date.now
  }) {
    this.#runtime = validateRuntime(runtime);
    this.#broker = validateBroker(broker);
    mailboxPaths(root, 1);
    createMailboxManifest({
      channelId,
      subject: broker.subject,
      maxRequestBytes,
      maxResponseBytes
    });
    validateTiming({ pollIntervalMs, maxRequests, clock });
    this.#root = root;
    this.#channelId = channelId;
    this.#pollIntervalMs = pollIntervalMs;
    this.#maxRequestBytes = maxRequestBytes;
    this.#maxResponseBytes = maxResponseBytes;
    this.#maxRequests = maxRequests;
    this.#clock = clock;
  }

  get nextSequence() { return this.#nextSequence; }

  async initialize() {
    if (this.#initialized) throw new MailboxHostError("already_initialized", "mailbox host is already initialized");
    await this.#runtime.createDirectory(this.#root, { recursive: true });
    const manifest = createMailboxManifest({
      channelId: this.#channelId,
      subject: this.#broker.subject,
      maxRequestBytes: this.#maxRequestBytes,
      maxResponseBytes: this.#maxResponseBytes
    });
    await this.#runtime.writeTextFile(
      `${this.#root}/manifest.json`,
      serializeMailboxValue(manifest, 64 * 1024, "mailbox manifest")
    );
    this.#initialized = true;
    return manifest;
  }

  snapshot() {
    return Object.freeze({
      schemaVersion: 1,
      channelId: this.#channelId,
      subject: this.#broker.subject,
      nextSequence: this.#nextSequence,
      processed: this.#events.length,
      events: Object.freeze([...this.#events])
    });
  }

  async #markerExists(path) {
    try {
      await this.#runtime.readTextFile(path, { maxBytes: 1024 });
      return true;
    } catch {
      return false;
    }
  }

  async #waitForMarker(path, { signal, timeoutMs }) {
    const startedAt = this.#clock();
    while (true) {
      if (signal?.aborted) throw new MailboxHostError("cancelled", "mailbox wait was cancelled");
      if (await this.#markerExists(path)) return;
      if (this.#clock() - startedAt >= timeoutMs) {
        throw new MailboxHostError("timeout", "mailbox request timed out");
      }
      await delay(this.#pollIntervalMs, signal);
    }
  }

  async #writeResponse(paths, response) {
    let envelope = response;
    let serialized;
    try {
      serialized = serializeMailboxValue(envelope, this.#maxResponseBytes, "mailbox response");
    } catch (error) {
      if (!(error instanceof MailboxProtocolError)) throw error;
      const code = error.code === "payload_too_large" ? "response_too_large" : "transport_failed";
      envelope = createMailboxResponse({
        channelId: this.#channelId,
        sequence: response.sequence,
        id: response.id,
        ok: false,
        error: publicError(code)
      });
      serialized = serializeMailboxValue(envelope, this.#maxResponseBytes, "mailbox response");
    }
    await this.#runtime.writeTextFile(paths.response, serialized);
    await this.#runtime.writeTextFile(paths.responseReady, "ready");
    return envelope;
  }

  #record({ sequence, id, capability, scope, outcome, code, startedAt }) {
    const now = this.#clock();
    const event = Object.freeze({
      schemaVersion: 1,
      sequence,
      ...(id ? { id } : {}),
      ...(capability ? { capability } : {}),
      ...(scope ? { scope } : {}),
      outcome,
      ...(code ? { code } : {}),
      durationMs: Math.max(0, now - startedAt)
    });
    this.#events.push(event);
    return event;
  }

  async processNext({ signal, timeoutMs = 30_000 } = {}) {
    if (!this.#initialized) throw new MailboxHostError("not_initialized", "mailbox host is not initialized");
    if (this.#nextSequence > this.#maxRequests) {
      throw new MailboxHostError("request_limit", "mailbox request limit is exhausted");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 300_000) {
      throw new TypeError("mailbox request timeout is invalid");
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError("mailbox request signal is invalid");
    }

    const sequence = this.#nextSequence;
    const paths = mailboxPaths(this.#root, sequence);
    const startedAt = this.#clock();
    await this.#waitForMarker(paths.requestReady, { signal, timeoutMs });

    let request;
    try {
      const text = await this.#runtime.readTextFile(paths.request, { maxBytes: this.#maxRequestBytes });
      request = parseMailboxRequest(text, {
        channelId: this.#channelId,
        sequence,
        maxBytes: this.#maxRequestBytes
      });
    } catch {
      const response = await this.#writeResponse(paths, createMailboxResponse({
        channelId: this.#channelId,
        sequence,
        id: null,
        ok: false,
        error: publicError("invalid_request")
      }));
      this.#nextSequence += 1;
      const event = this.#record({ sequence, outcome: "denied", code: "invalid_request", startedAt });
      return Object.freeze({ response, event });
    }

    if (this.#seenIds.has(request.id)) {
      const response = await this.#writeResponse(paths, createMailboxResponse({
        channelId: this.#channelId,
        sequence,
        id: request.id,
        ok: false,
        error: publicError("replay_rejected")
      }));
      this.#nextSequence += 1;
      const event = this.#record({
        sequence,
        id: request.id,
        capability: request.capability,
        scope: request.scope,
        outcome: "denied",
        code: "replay_rejected",
        startedAt
      });
      return Object.freeze({ response, event });
    }
    this.#seenIds.add(request.id);

    const requestController = new AbortController();
    const cancelWatch = new AbortController();
    const abortRequest = () => requestController.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });
    const cancellation = this.#waitForMarker(paths.cancelReady, {
      signal: cancelWatch.signal,
      timeoutMs: 300_000
    }).then(abortRequest, () => {});

    let response;
    try {
      if (signal?.aborted || await this.#markerExists(paths.cancelReady)) requestController.abort();
      const result = await this.#broker.request({
        id: request.id,
        capability: request.capability,
        scope: request.scope,
        input: request.input
      }, { signal: requestController.signal });
      response = createMailboxResponse({
        channelId: this.#channelId,
        sequence,
        id: request.id,
        ok: true,
        result
      });
    } catch (error) {
      const code = error instanceof CapabilityBrokerError ? error.code : "transport_failed";
      response = createMailboxResponse({
        channelId: this.#channelId,
        sequence,
        id: request.id,
        ok: false,
        error: publicError(code)
      });
    } finally {
      cancelWatch.abort();
      signal?.removeEventListener("abort", abortRequest);
      await cancellation;
    }

    response = await this.#writeResponse(paths, response);
    this.#nextSequence += 1;
    const outcome = response.ok ? "allowed" : response.error.code === "cancelled" ? "cancelled" : "denied";
    const event = this.#record({
      sequence,
      id: request.id,
      capability: request.capability,
      scope: request.scope,
      outcome,
      ...response.ok ? {} : { code: response.error.code },
      startedAt
    });
    return Object.freeze({ response, event });
  }

  async serve({ signal, maxRequests = this.#maxRequests } = {}) {
    if (!(signal instanceof AbortSignal)) throw new TypeError("mailbox serve requires an AbortSignal");
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > this.#maxRequests) {
      throw new TypeError("mailbox serve request limit is invalid");
    }
    const results = [];
    while (!signal.aborted && results.length < maxRequests) {
      try { results.push(await this.processNext({ signal, timeoutMs: 300_000 })); }
      catch (error) {
        if (signal.aborted && error instanceof MailboxHostError && error.code === "cancelled") break;
        throw error;
      }
    }
    return Object.freeze(results);
  }
}
