const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_SCOPE_LENGTH = 256;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || value.length > 128 || !IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function assertScope(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SCOPE_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError("capability scope is invalid");
  }
  return value;
}

function assertSubject(subject) {
  if (!isPlainObject(subject) || !isPlainObject(subject.artifact)) {
    throw new TypeError("broker subject must include an exact artifact identity");
  }
  const artifact = subject.artifact;
  if (artifact.package !== "openclaw" || typeof artifact.version !== "string" || artifact.version.length === 0
    || typeof artifact.integrity !== "string" || !artifact.integrity.startsWith("sha512-")) {
    throw new TypeError("broker subject OpenClaw artifact identity is invalid");
  }
  assertIdentifier(subject.runtime, "broker runtime");
  if (typeof subject.sessionId !== "string" || !REQUEST_ID_PATTERN.test(subject.sessionId)) {
    throw new TypeError("broker session identifier is invalid");
  }
  return Object.freeze({
    artifact: Object.freeze({
      package: artifact.package,
      version: artifact.version,
      integrity: artifact.integrity
    }),
    runtime: subject.runtime,
    sessionId: subject.sessionId
  });
}

function normalizeGrant(grant) {
  if (!isPlainObject(grant)) throw new TypeError("capability grant is invalid");
  const capability = assertIdentifier(grant.capability, "capability identifier");
  const scope = assertScope(grant.scope);
  const maxCalls = grant.maxCalls ?? 1;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 10_000) {
    throw new TypeError("capability call limit is invalid");
  }
  let expiresAt;
  if (grant.expiresAt !== undefined) {
    expiresAt = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiresAt)) throw new TypeError("capability expiry is invalid");
  }
  return { capability, scope, maxCalls, expiresAt, callsUsed: 0 };
}

function grantKey(capability, scope) {
  return `${capability}\u0000${scope}`;
}

export class CapabilityBrokerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CapabilityBrokerError";
    this.code = code;
  }
}

/**
 * Deny-by-default broker for requests crossing from an untrusted OpenClaw guest
 * into the trusted browser host. Audit records intentionally exclude payloads,
 * handler results, credentials, and underlying exception messages.
 */
export class CapabilityBroker {
  #subject;
  #handlers;
  #grants = new Map();
  #audit = [];
  #sequence = 0;
  #clock;
  #auditSink;
  #maxAuditEntries;
  #auditTruncated = false;

  constructor({ subject, grants = [], handlers = {}, clock = Date.now, auditSink, maxAuditEntries = 1_000 }) {
    this.#subject = assertSubject(subject);
    if (!isPlainObject(handlers)) throw new TypeError("capability handlers are invalid");
    this.#handlers = new Map(Object.entries(handlers).map(([capability, handler]) => {
      assertIdentifier(capability, "capability handler identifier");
      if (typeof handler !== "function") throw new TypeError(`capability handler ${capability} is invalid`);
      return [capability, handler];
    }));
    if (typeof clock !== "function") throw new TypeError("broker clock is invalid");
    if (auditSink !== undefined && typeof auditSink !== "function") throw new TypeError("broker audit sink is invalid");
    if (!Number.isSafeInteger(maxAuditEntries) || maxAuditEntries < 1 || maxAuditEntries > 100_000) {
      throw new TypeError("broker audit limit is invalid");
    }
    this.#clock = clock;
    this.#auditSink = auditSink;
    this.#maxAuditEntries = maxAuditEntries;
    for (const grant of grants) this.#setGrant(grant);
  }

  get subject() {
    return this.#subject;
  }

  #setGrant(untrustedGrant) {
    const grant = normalizeGrant(untrustedGrant);
    this.#grants.set(grantKey(grant.capability, grant.scope), grant);
    return grant;
  }

  #record({ action, capability, scope, requestId, outcome, reason, startedAt }) {
    const now = this.#clock();
    const event = Object.freeze({
      schemaVersion: 1,
      sequence: ++this.#sequence,
      timestamp: new Date(now).toISOString(),
      durationMs: Math.max(0, now - startedAt),
      action,
      capability,
      scope,
      ...(requestId ? { requestId } : {}),
      outcome,
      reason
    });
    if (this.#audit.length === this.#maxAuditEntries) {
      this.#audit.shift();
      this.#auditTruncated = true;
    }
    this.#audit.push(event);
    this.#auditSink?.(event);
    return event;
  }

  grant(untrustedGrant) {
    const startedAt = this.#clock();
    const grant = this.#setGrant(untrustedGrant);
    this.#record({
      action: "grant",
      capability: grant.capability,
      scope: grant.scope,
      outcome: "granted",
      reason: "explicit_grant",
      startedAt
    });
  }

  revoke(capability, scope) {
    const startedAt = this.#clock();
    assertIdentifier(capability, "capability identifier");
    assertScope(scope);
    const revoked = this.#grants.delete(grantKey(capability, scope));
    this.#record({
      action: "revoke",
      capability,
      scope,
      outcome: revoked ? "revoked" : "unchanged",
      reason: revoked ? "explicit_revoke" : "grant_not_found",
      startedAt
    });
    return revoked;
  }

  auditSnapshot() {
    return Object.freeze({
      schemaVersion: 1,
      subject: this.#subject,
      truncated: this.#auditTruncated,
      events: Object.freeze([...this.#audit])
    });
  }

  async request(untrustedRequest, { signal } = {}) {
    const startedAt = this.#clock();
    if (!isPlainObject(untrustedRequest) || typeof untrustedRequest.id !== "string"
      || !REQUEST_ID_PATTERN.test(untrustedRequest.id)) {
      throw new CapabilityBrokerError("invalid_request", "capability request is invalid");
    }
    let capability;
    let scope;
    try {
      capability = assertIdentifier(untrustedRequest.capability, "capability identifier");
      scope = assertScope(untrustedRequest.scope);
    } catch {
      throw new CapabilityBrokerError("invalid_request", "capability request is invalid");
    }
    const audit = (outcome, reason) => this.#record({
      action: "request",
      capability,
      scope,
      requestId: untrustedRequest.id,
      outcome,
      reason,
      startedAt
    });
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      audit("denied", "invalid_signal");
      throw new CapabilityBrokerError("invalid_request", "capability request signal is invalid");
    }
    if (signal?.aborted) {
      audit("cancelled", "request_cancelled");
      throw new CapabilityBrokerError("cancelled", "capability request was cancelled");
    }
    const grant = this.#grants.get(grantKey(capability, scope));
    if (!grant) {
      audit("denied", "not_granted");
      throw new CapabilityBrokerError("not_granted", "capability is not granted for this exact scope");
    }
    if (grant.expiresAt !== undefined && this.#clock() >= grant.expiresAt) {
      audit("denied", "grant_expired");
      throw new CapabilityBrokerError("grant_expired", "capability grant has expired");
    }
    if (grant.callsUsed >= grant.maxCalls) {
      audit("denied", "call_limit_exhausted");
      throw new CapabilityBrokerError("call_limit_exhausted", "capability call limit is exhausted");
    }
    const handler = this.#handlers.get(capability);
    if (!handler) {
      audit("denied", "handler_unavailable");
      throw new CapabilityBrokerError("handler_unavailable", "capability handler is unavailable");
    }

    grant.callsUsed += 1;
    try {
      const result = await handler(untrustedRequest.input, Object.freeze({
        subject: this.#subject,
        capability,
        scope,
        requestId: untrustedRequest.id,
        signal
      }));
      if (signal?.aborted) {
        audit("cancelled", "request_cancelled");
        throw new CapabilityBrokerError("cancelled", "capability request was cancelled");
      }
      audit("allowed", "grant_matched");
      return result;
    } catch (error) {
      if (error instanceof CapabilityBrokerError) throw error;
      if (signal?.aborted) {
        audit("cancelled", "request_cancelled");
        throw new CapabilityBrokerError("cancelled", "capability request was cancelled");
      }
      audit("error", "handler_failed");
      throw new CapabilityBrokerError("handler_failed", "capability handler failed");
    }
  }
}

export async function runCapabilityBrokerPolicyProbe() {
  const secret = `broker-probe-${crypto.randomUUID()}`;
  let handled = 0;
  const broker = new CapabilityBroker({
    subject: {
      artifact: { package: "openclaw", version: "probe", integrity: "sha512-probe" },
      runtime: "browserpod",
      sessionId: "probe-session"
    },
    grants: [{
      capability: "provider.openai.responses",
      scope: "model:clawsembly-policy-probe",
      maxCalls: 1
    }],
    handlers: {
      "provider.openai.responses": async (input) => {
        handled += 1;
        return { accepted: Boolean(input) };
      }
    }
  });
  await broker.request({
    id: "allowed-probe",
    capability: "provider.openai.responses",
    scope: "model:clawsembly-policy-probe",
    input: { secret }
  });
  let ungrantedDenied = false;
  let limitDenied = false;
  try {
    await broker.request({ id: "denied-scope", capability: "provider.openai.responses", scope: "model:other", input: {} });
  } catch (error) {
    ungrantedDenied = error instanceof CapabilityBrokerError && error.code === "not_granted";
  }
  try {
    await broker.request({ id: "denied-limit", capability: "provider.openai.responses", scope: "model:clawsembly-policy-probe", input: {} });
  } catch (error) {
    limitDenied = error instanceof CapabilityBrokerError && error.code === "call_limit_exhausted";
  }
  const audit = broker.auditSnapshot();
  const payloadRedacted = !JSON.stringify(audit).includes(secret);
  if (handled !== 1 || !ungrantedDenied || !limitDenied || !payloadRedacted) {
    throw new Error("capability broker policy probe failed");
  }
  return Object.freeze({
    result: "pass",
    runtime: "browserpod",
    defaultDeny: true,
    exactScope: true,
    callLimit: true,
    payloadRedacted: true,
    auditEvents: audit.events.length
  });
}
