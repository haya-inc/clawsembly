const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const MAX_SCOPE_LENGTH = 256;
const DEFAULT_DURATION_MS = 15 * 60 * 1_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;

function key(capability, scope) {
  return `${capability}\u0000${scope}`;
}

function assertCapability(value) {
  if (typeof value !== "string" || value.length > 128 || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError("permission capability is invalid");
  }
  return value;
}

function assertScope(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SCOPE_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("permission scope is invalid");
  }
  return value;
}

function normalizeRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new TypeError("permission request is invalid");
  }
  const capability = assertCapability(request.capability);
  const scope = assertScope(request.scope);
  const maxCalls = request.maxCalls ?? 1;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10_000) {
    throw new TypeError("permission request call limit is invalid");
  }
  return { capability, scope, requestedMaxCalls: maxCalls };
}

function assertDecision({ durationMs, maxCalls }, requestedMaxCalls) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1_000 || durationMs > MAX_DURATION_MS) {
    throw new TypeError("permission duration is invalid");
  }
  const effectiveMaxCalls = maxCalls ?? requestedMaxCalls;
  if (!Number.isSafeInteger(effectiveMaxCalls) || effectiveMaxCalls < 1
    || effectiveMaxCalls > requestedMaxCalls) {
    throw new TypeError("permission call limit exceeds the request");
  }
  return effectiveMaxCalls;
}

function safeSink(sink, event) {
  try { sink?.(event); }
  catch { /* Permission audit consumers cannot change authority. */ }
}

/**
 * Converts manifest capability requests into explicit, expiring user decisions.
 * It never accepts request payloads, credentials, or free-form denial reasons.
 */
export class CapabilityConsentController {
  #broker;
  #clock;
  #sink;
  #maxEvents;
  #events = [];
  #truncated = false;
  #sequence = 0;
  #permissions = new Map();

  constructor({ broker, requests = [], clock = Date.now, auditSink, maxAuditEntries = 1_000 }) {
    if (!broker || typeof broker.grant !== "function" || typeof broker.revoke !== "function"
      || typeof broker.auditSnapshot !== "function" || !broker.subject) {
      throw new TypeError("a capability broker is required for permission consent");
    }
    if (!Array.isArray(requests)) throw new TypeError("permission requests must be an array");
    if (typeof clock !== "function") throw new TypeError("permission clock is invalid");
    if (auditSink !== undefined && typeof auditSink !== "function") {
      throw new TypeError("permission audit sink is invalid");
    }
    if (!Number.isSafeInteger(maxAuditEntries) || maxAuditEntries < 1 || maxAuditEntries > 100_000) {
      throw new TypeError("permission audit limit is invalid");
    }
    this.#broker = broker;
    this.#clock = clock;
    this.#sink = auditSink;
    this.#maxEvents = maxAuditEntries;
    for (const untrusted of requests) {
      const request = normalizeRequest(untrusted);
      const requestKey = key(request.capability, request.scope);
      if (this.#permissions.has(requestKey)) throw new TypeError("permission requests must be unique");
      this.#permissions.set(requestKey, {
        ...request,
        status: "pending",
        expiresAt: null,
        grantedMaxCalls: null
      });
    }
  }

  #get(capability, scope) {
    const normalizedCapability = assertCapability(capability);
    const normalizedScope = assertScope(scope);
    const permission = this.#permissions.get(key(normalizedCapability, normalizedScope));
    if (!permission) throw new TypeError("permission was not requested by the verified manifest");
    return permission;
  }

  #record(permission, action, outcome, reason) {
    const event = Object.freeze({
      schemaVersion: 1,
      sequence: ++this.#sequence,
      timestamp: new Date(this.#clock()).toISOString(),
      action,
      capability: permission.capability,
      scope: permission.scope,
      outcome,
      reason
    });
    if (this.#events.length === this.#maxEvents) {
      this.#events.shift();
      this.#truncated = true;
    }
    this.#events.push(event);
    safeSink(this.#sink, event);
    return event;
  }

  #refresh(permission) {
    if (permission.status !== "granted" || permission.expiresAt === null
      || this.#clock() < Date.parse(permission.expiresAt)) return;
    this.#broker.revoke(permission.capability, permission.scope);
    permission.status = "expired";
    this.#record(permission, "expire", "expired", "grant_expired");
  }

  approve(capability, scope, { durationMs = DEFAULT_DURATION_MS, maxCalls } = {}) {
    const permission = this.#get(capability, scope);
    const effectiveMaxCalls = assertDecision({ durationMs, maxCalls }, permission.requestedMaxCalls);
    const expiresAt = new Date(this.#clock() + durationMs).toISOString();
    this.#broker.grant({
      capability: permission.capability,
      scope: permission.scope,
      maxCalls: effectiveMaxCalls,
      expiresAt
    });
    permission.status = "granted";
    permission.expiresAt = expiresAt;
    permission.grantedMaxCalls = effectiveMaxCalls;
    this.#record(permission, "approve", "granted", "user_approved");
    return Object.freeze({ ...permission });
  }

  deny(capability, scope) {
    const permission = this.#get(capability, scope);
    this.#refresh(permission);
    if (permission.status === "granted") this.#broker.revoke(permission.capability, permission.scope);
    permission.status = "denied";
    permission.expiresAt = null;
    permission.grantedMaxCalls = null;
    this.#record(permission, "deny", "denied", "user_denied");
  }

  revoke(capability, scope) {
    const permission = this.#get(capability, scope);
    this.#refresh(permission);
    const revoked = this.#broker.revoke(permission.capability, permission.scope);
    permission.status = "revoked";
    permission.expiresAt = null;
    permission.grantedMaxCalls = null;
    this.#record(permission, "revoke", revoked ? "revoked" : "unchanged", revoked ? "user_revoked" : "grant_not_active");
    return revoked;
  }

  manifest() {
    for (const permission of this.#permissions.values()) this.#refresh(permission);
    return Object.freeze({
      schemaVersion: 1,
      generatedAt: new Date(this.#clock()).toISOString(),
      subject: this.#broker.subject,
      permissions: Object.freeze([...this.#permissions.values()].map((permission) => Object.freeze({ ...permission })))
    });
  }

  exportAudit() {
    const permissionManifest = this.manifest();
    return Object.freeze({
      schemaVersion: 1,
      generatedAt: permissionManifest.generatedAt,
      subject: this.#broker.subject,
      permissionAudit: Object.freeze({
        truncated: this.#truncated,
        events: Object.freeze([...this.#events])
      }),
      brokerAudit: this.#broker.auditSnapshot()
    });
  }
}
