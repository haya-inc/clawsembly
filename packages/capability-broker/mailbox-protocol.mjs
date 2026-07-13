export const CAPABILITY_MAILBOX_SCHEMA_VERSION = 1;
export const DEFAULT_MAILBOX_MAX_BYTES = 256 * 1024;
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const MAX_SEQUENCE = 99_999_999;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new MailboxProtocolError("invalid_envelope", `${label} fields are invalid`);
  }
}

function assertChannelId(value) {
  if (typeof value !== "string" || !CHANNEL_PATTERN.test(value)) {
    throw new MailboxProtocolError("invalid_channel", "mailbox channel identifier is invalid");
  }
  return value;
}

function assertSequence(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SEQUENCE) {
    throw new MailboxProtocolError("invalid_sequence", "mailbox sequence is invalid");
  }
  return value;
}

function assertMaxBytes(value) {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 4 * 1024 * 1024) {
    throw new MailboxProtocolError("invalid_limit", "mailbox payload limit is invalid");
  }
  return value;
}

function assertRoot(root) {
  const segments = typeof root === "string" ? root.split("/") : [];
  if (typeof root !== "string" || !root.startsWith("/") || root === "/" || root.endsWith("/")
    || root.length > 4_096 || root.includes("\0")
    || segments.slice(1).some((segment) => !segment || segment === "." || segment === "..")) {
    throw new MailboxProtocolError("invalid_root", "mailbox root must be a normalized absolute guest path");
  }
  return root;
}

function assertRequestIdentity(value, label) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    throw new MailboxProtocolError("invalid_envelope", `${label} is invalid`);
  }
  return value;
}

function assertCapability(value) {
  if (typeof value !== "string" || value.length > 128 || !IDENTIFIER_PATTERN.test(value)) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox capability is invalid");
  }
  return value;
}

function assertScope(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox scope is invalid");
  }
  return value;
}

function assertArtifact(value) {
  if (!isPlainObject(value)) throw new MailboxProtocolError("invalid_manifest", "mailbox artifact is invalid");
  assertExactKeys(value, ["package", "version", "integrity"], "mailbox artifact");
  if (typeof value.package !== "string" || value.package.length > PACKAGE_NAME_MAX_LENGTH
    || !PACKAGE_NAME_PATTERN.test(value.package)
    || typeof value.version !== "string" || value.version.length === 0
    || typeof value.integrity !== "string" || !value.integrity.startsWith("sha512-")) {
    throw new MailboxProtocolError("invalid_manifest", "mailbox artifact is invalid");
  }
  return Object.freeze({ package: value.package, version: value.version, integrity: value.integrity });
}

function assertSubject(value) {
  if (!isPlainObject(value)) throw new MailboxProtocolError("invalid_manifest", "mailbox subject is invalid");
  assertExactKeys(value, ["artifact", "runtime", "sessionId"], "mailbox subject");
  if (value.runtime !== "browserpod") {
    throw new MailboxProtocolError("invalid_manifest", "mailbox runtime is invalid");
  }
  return Object.freeze({
    artifact: assertArtifact(value.artifact),
    runtime: "browserpod",
    sessionId: assertRequestIdentity(value.sessionId, "mailbox session identifier")
  });
}

export class MailboxProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MailboxProtocolError";
    this.code = code;
  }
}

export function mailboxPaths(root, sequence) {
  const normalizedRoot = assertRoot(root);
  const slot = String(assertSequence(sequence)).padStart(8, "0");
  return Object.freeze({
    request: `${normalizedRoot}/request-${slot}.json`,
    requestReady: `${normalizedRoot}/request-${slot}.ready`,
    cancelReady: `${normalizedRoot}/cancel-${slot}.ready`,
    response: `${normalizedRoot}/response-${slot}.json`,
    responseReady: `${normalizedRoot}/response-${slot}.ready`
  });
}

export function serializeMailboxValue(value, maxBytes = DEFAULT_MAILBOX_MAX_BYTES, label = "mailbox payload") {
  assertMaxBytes(maxBytes);
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new MailboxProtocolError("invalid_payload", `${label} is not JSON serializable`); }
  if (typeof serialized !== "string") {
    throw new MailboxProtocolError("invalid_payload", `${label} is not JSON serializable`);
  }
  if (new TextEncoder().encode(serialized).byteLength > maxBytes) {
    throw new MailboxProtocolError("payload_too_large", `${label} exceeds the byte limit`);
  }
  return serialized;
}

export function parseMailboxValue(text, maxBytes = DEFAULT_MAILBOX_MAX_BYTES, label = "mailbox payload") {
  assertMaxBytes(maxBytes);
  if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new MailboxProtocolError("payload_too_large", `${label} exceeds the byte limit`);
  }
  try { return JSON.parse(text); }
  catch { throw new MailboxProtocolError("invalid_payload", `${label} is not valid JSON`); }
}

export function createMailboxManifest({ channelId, subject, maxRequestBytes, maxResponseBytes }) {
  return Object.freeze({
    schemaVersion: CAPABILITY_MAILBOX_SCHEMA_VERSION,
    channelId: assertChannelId(channelId),
    subject: assertSubject(subject),
    limits: Object.freeze({
      maxRequestBytes: assertMaxBytes(maxRequestBytes),
      maxResponseBytes: assertMaxBytes(maxResponseBytes)
    })
  });
}

export function parseMailboxManifest(text, { channelId, maxBytes = 64 * 1024 } = {}) {
  const value = parseMailboxValue(text, maxBytes, "mailbox manifest");
  if (!isPlainObject(value)) throw new MailboxProtocolError("invalid_manifest", "mailbox manifest is invalid");
  assertExactKeys(value, ["schemaVersion", "channelId", "subject", "limits"], "mailbox manifest");
  if (value.schemaVersion !== CAPABILITY_MAILBOX_SCHEMA_VERSION || value.channelId !== assertChannelId(channelId)
    || !isPlainObject(value.limits)) {
    throw new MailboxProtocolError("invalid_manifest", "mailbox manifest does not match this channel");
  }
  assertExactKeys(value.limits, ["maxRequestBytes", "maxResponseBytes"], "mailbox limits");
  return createMailboxManifest({
    channelId: value.channelId,
    subject: value.subject,
    maxRequestBytes: value.limits.maxRequestBytes,
    maxResponseBytes: value.limits.maxResponseBytes
  });
}

export function createMailboxRequest({ channelId, sequence, id, capability, scope, input }) {
  return Object.freeze({
    schemaVersion: CAPABILITY_MAILBOX_SCHEMA_VERSION,
    channelId: assertChannelId(channelId),
    sequence: assertSequence(sequence),
    id: assertRequestIdentity(id, "mailbox request identifier"),
    capability: assertCapability(capability),
    scope: assertScope(scope),
    input: input ?? null
  });
}

export function parseMailboxRequest(text, { channelId, sequence, maxBytes = DEFAULT_MAILBOX_MAX_BYTES }) {
  const value = parseMailboxValue(text, maxBytes, "mailbox request");
  if (!isPlainObject(value)) throw new MailboxProtocolError("invalid_envelope", "mailbox request is invalid");
  assertExactKeys(
    value,
    ["schemaVersion", "channelId", "sequence", "id", "capability", "scope", "input"],
    "mailbox request"
  );
  if (value.schemaVersion !== CAPABILITY_MAILBOX_SCHEMA_VERSION
    || value.channelId !== assertChannelId(channelId) || value.sequence !== assertSequence(sequence)) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox request does not match its channel slot");
  }
  return createMailboxRequest(value);
}

export function createMailboxResponse({ channelId, sequence, id, ok, result, error }) {
  if (ok !== true && ok !== false) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox response outcome is invalid");
  }
  const base = {
    schemaVersion: CAPABILITY_MAILBOX_SCHEMA_VERSION,
    channelId: assertChannelId(channelId),
    sequence: assertSequence(sequence),
    id: id === null ? null : assertRequestIdentity(id, "mailbox response identifier"),
    ok: ok === true
  };
  if (base.ok) return Object.freeze({ ...base, result: result ?? null });
  if (!isPlainObject(error)) throw new MailboxProtocolError("invalid_envelope", "mailbox response error is invalid");
  assertExactKeys(error, ["code", "message"], "mailbox response error");
  if (typeof error.code !== "string" || !IDENTIFIER_PATTERN.test(error.code)
    || typeof error.message !== "string" || error.message.length === 0 || error.message.length > 256) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox response error is invalid");
  }
  return Object.freeze({ ...base, error: Object.freeze({ code: error.code, message: error.message }) });
}

export function parseMailboxResponse(text, { channelId, sequence, id, maxBytes = DEFAULT_MAILBOX_MAX_BYTES }) {
  const value = parseMailboxValue(text, maxBytes, "mailbox response");
  if (!isPlainObject(value)) throw new MailboxProtocolError("invalid_envelope", "mailbox response is invalid");
  assertExactKeys(
    value,
    value.ok === true
      ? ["schemaVersion", "channelId", "sequence", "id", "ok", "result"]
      : ["schemaVersion", "channelId", "sequence", "id", "ok", "error"],
    "mailbox response"
  );
  const expectedId = assertRequestIdentity(id, "mailbox response request identifier");
  if (value.schemaVersion !== CAPABILITY_MAILBOX_SCHEMA_VERSION
    || value.channelId !== assertChannelId(channelId) || value.sequence !== assertSequence(sequence)
    || value.id !== expectedId) {
    throw new MailboxProtocolError("invalid_envelope", "mailbox response does not match its request");
  }
  return createMailboxResponse(value);
}
