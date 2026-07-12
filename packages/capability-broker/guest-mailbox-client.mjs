import { access, readFile, rm, stat, writeFile } from "node:fs/promises";

import {
  MailboxProtocolError,
  createMailboxRequest,
  mailboxPaths,
  parseMailboxManifest,
  parseMailboxResponse,
  serializeMailboxValue
} from "./mailbox-protocol.mjs";

function validateOptions({ pollIntervalMs, startSequence, clock }) {
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 5 || pollIntervalMs > 5_000) {
    throw new TypeError("mailbox poll interval is invalid");
  }
  mailboxPaths("/mailbox-validation", startSequence);
  if (typeof clock !== "function") throw new TypeError("mailbox clock is invalid");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function markerExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readBounded(path, maxBytes, label) {
  const metadata = await stat(path);
  if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > maxBytes) {
    throw new MailboxGuestError("payload_too_large", `${label} exceeds the byte limit`);
  }
  return readFile(path, "utf8");
}

async function writeExclusive(path, contents) {
  try { await writeFile(path, contents, { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch { throw new MailboxGuestError("slot_unavailable", "mailbox slot is already in use"); }
}

async function writeCancel(path) {
  try { await writeFile(path, "cancel", { encoding: "utf8", mode: 0o600, flag: "wx" }); }
  catch (error) {
    if (error?.code !== "EEXIST") {
      throw new MailboxGuestError("cancel_failed", "mailbox cancellation marker could not be written");
    }
  }
}

export class MailboxGuestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MailboxGuestError";
    this.code = code;
  }
}

/**
 * Node-side client copied into the untrusted BrowserPod guest. It can request
 * only what the host's exact CapabilityBroker grants; the manifest is for
 * channel binding and discovery, never a source of authority.
 */
export class FilesystemCapabilityMailboxClient {
  #root;
  #channelId;
  #pollIntervalMs;
  #clock;
  #nextSequence;
  #manifest;

  constructor({
    root,
    channelId,
    pollIntervalMs = 50,
    startSequence = 1,
    clock = Date.now
  }) {
    mailboxPaths(root, startSequence);
    validateOptions({ pollIntervalMs, startSequence, clock });
    this.#root = root;
    this.#channelId = channelId;
    this.#pollIntervalMs = pollIntervalMs;
    this.#nextSequence = startSequence;
    this.#clock = clock;
  }

  get manifest() { return this.#manifest; }
  get nextSequence() { return this.#nextSequence; }

  async connect() {
    if (this.#manifest) throw new MailboxGuestError("already_connected", "mailbox client is already connected");
    let text;
    try { text = await readBounded(`${this.#root}/manifest.json`, 64 * 1024, "mailbox manifest"); }
    catch (error) {
      if (error instanceof MailboxGuestError) throw error;
      throw new MailboxGuestError("manifest_unavailable", "mailbox manifest is unavailable");
    }
    try { this.#manifest = parseMailboxManifest(text, { channelId: this.#channelId }); }
    catch {
      throw new MailboxGuestError("invalid_manifest", "mailbox manifest is invalid");
    }
    return this.#manifest;
  }

  async #cleanup(paths) {
    await Promise.allSettled([
      paths.request,
      paths.requestReady,
      paths.cancelReady,
      paths.response,
      paths.responseReady
    ].map((path) => rm(path, { force: true })));
  }

  async request({ id, capability, scope, input }, { signal, timeoutMs = 30_000 } = {}) {
    if (!this.#manifest) throw new MailboxGuestError("not_connected", "mailbox client is not connected");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 300_000) {
      throw new TypeError("mailbox response timeout is invalid");
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new TypeError("mailbox request signal is invalid");
    }

    const sequence = this.#nextSequence++;
    const paths = mailboxPaths(this.#root, sequence);
    let request;
    let serialized;
    try {
      request = createMailboxRequest({
        schemaVersion: 1,
        channelId: this.#channelId,
        sequence,
        id,
        capability,
        scope,
        input
      });
      serialized = serializeMailboxValue(
        request,
        this.#manifest.limits.maxRequestBytes,
        "mailbox request"
      );
    } catch (error) {
      if (error instanceof MailboxProtocolError) {
        throw new MailboxGuestError(error.code, "mailbox request is invalid");
      }
      throw error;
    }

    await writeExclusive(paths.request, serialized);
    await writeExclusive(paths.requestReady, "ready");

    const startedAt = this.#clock();
    let cancelSent = false;
    while (!await markerExists(paths.responseReady)) {
      if (signal?.aborted && !cancelSent) {
        await writeCancel(paths.cancelReady);
        cancelSent = true;
      }
      if (this.#clock() - startedAt >= timeoutMs) {
        await writeCancel(paths.cancelReady);
        throw new MailboxGuestError("timeout", "mailbox response timed out");
      }
      await delay(this.#pollIntervalMs);
    }

    let response;
    try {
      const text = await readBounded(
        paths.response,
        this.#manifest.limits.maxResponseBytes,
        "mailbox response"
      );
      response = parseMailboxResponse(text, {
        channelId: this.#channelId,
        sequence,
        id: request.id,
        maxBytes: this.#manifest.limits.maxResponseBytes
      });
    } catch (error) {
      await this.#cleanup(paths);
      if (error instanceof MailboxGuestError) throw error;
      throw new MailboxGuestError("invalid_response", "mailbox response is invalid");
    }
    await this.#cleanup(paths);

    if (cancelSent && response.ok) {
      throw new MailboxGuestError("cancelled", "capability request was cancelled");
    }
    if (!response.ok) throw new MailboxGuestError(response.error.code, response.error.message);
    return response.result;
  }
}
