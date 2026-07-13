const DURATION_OPTIONS = Object.freeze([
  Object.freeze({ value: 5 * 60_000, label: "5 minutes" }),
  Object.freeze({ value: 15 * 60_000, label: "15 minutes" }),
  Object.freeze({ value: 60 * 60_000, label: "1 hour" })
]);

const STATUS_LABELS = Object.freeze({
  pending: "Pending decision",
  granted: "Granted",
  denied: "Denied",
  revoked: "Revoked",
  expired: "Expired"
});

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function exactPackageName(value) {
  return typeof value === "string" && value.length <= PACKAGE_NAME_MAX_LENGTH
    && PACKAGE_NAME_PATTERN.test(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertController(controller) {
  if (!controller || typeof controller.manifest !== "function"
    || typeof controller.approve !== "function" || typeof controller.deny !== "function"
    || typeof controller.revoke !== "function" || typeof controller.exportAudit !== "function") {
    throw new TypeError("a capability consent controller is required");
  }
  return controller;
}

function assertContainer(container) {
  if (!container || typeof container.replaceChildren !== "function"
    || !container.ownerDocument || typeof container.ownerDocument.createElement !== "function") {
    throw new TypeError("a DOM container is required for the permission prompt");
  }
  return container;
}

function assertManifest(manifest) {
  if (!isPlainObject(manifest) || manifest.schemaVersion !== 1 || !isPlainObject(manifest.subject)
    || !isPlainObject(manifest.subject.artifact) || !Array.isArray(manifest.permissions)
    || !Number.isFinite(Date.parse(manifest.generatedAt))
    || !exactPackageName(manifest.subject.artifact.package)
    || typeof manifest.subject.artifact.version !== "string" || manifest.subject.artifact.version.length === 0
    || typeof manifest.subject.artifact.integrity !== "string" || !manifest.subject.artifact.integrity.startsWith("sha512-")
    || manifest.subject.runtime !== "browserpod" || !SESSION_PATTERN.test(manifest.subject.sessionId)) {
    throw new TypeError("permission manifest is invalid");
  }
  return manifest;
}

function statusSummary(permissions) {
  const counts = permissions.reduce((result, permission) => {
    result[permission.status] = (result[permission.status] ?? 0) + 1;
    return result;
  }, {});
  return ["pending", "granted", "denied", "revoked", "expired"]
    .filter((status) => counts[status])
    .map((status) => `${counts[status]} ${status}`)
    .join(" · ");
}

export function buildPermissionPromptModel(untrustedManifest, { now = Date.now() } = {}) {
  const manifest = assertManifest(untrustedManifest);
  if (!Number.isFinite(now)) throw new TypeError("permission prompt clock is invalid");
  const permissions = manifest.permissions.map((permission) => {
    if (!isPlainObject(permission) || typeof permission.capability !== "string"
      || permission.capability.length > 128 || !IDENTIFIER_PATTERN.test(permission.capability)
      || typeof permission.scope !== "string" || permission.scope.length === 0 || permission.scope.length > 256
      || !Number.isSafeInteger(permission.requestedMaxCalls) || permission.requestedMaxCalls < 1
      || permission.requestedMaxCalls > 10_000
      || !Object.hasOwn(STATUS_LABELS, permission.status)) {
      throw new TypeError("permission manifest entry is invalid");
    }
    const expiresAtMs = permission.expiresAt === null ? null : Date.parse(permission.expiresAt);
    if (expiresAtMs !== null && !Number.isFinite(expiresAtMs)) {
      throw new TypeError("permission expiry is invalid");
    }
    const decidedGrant = permission.status === "granted" || permission.status === "expired";
    if (decidedGrant !== (permission.expiresAt !== null)
      || decidedGrant !== Number.isSafeInteger(permission.grantedMaxCalls)
      || (decidedGrant && (permission.grantedMaxCalls < 1
        || permission.grantedMaxCalls > permission.requestedMaxCalls))) {
      throw new TypeError("permission grant state is invalid");
    }
    return Object.freeze({
      capability: permission.capability,
      scope: permission.scope,
      requestedMaxCalls: permission.requestedMaxCalls,
      grantedMaxCalls: permission.grantedMaxCalls,
      status: permission.status,
      statusLabel: STATUS_LABELS[permission.status],
      expiresAt: permission.expiresAt,
      remainingMs: expiresAtMs === null ? null : Math.max(0, expiresAtMs - now)
    });
  });
  return Object.freeze({
    generatedAt: manifest.generatedAt,
    subject: manifest.subject,
    summary: statusSummary(permissions),
    permissions: Object.freeze(permissions)
  });
}

function element(document, name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatExpiry(expiresAt) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(expiresAt));
}

export function mountCapabilityPermissionPrompt({
  container,
  permissions,
  durationOptions = DURATION_OPTIONS,
  onChange,
  onAuditExport,
  clock = Date.now
}) {
  const host = assertContainer(container);
  const controller = assertController(permissions);
  if (!Array.isArray(durationOptions) || durationOptions.length === 0
    || durationOptions.some((option) => !Number.isSafeInteger(option?.value)
      || option.value < 1_000 || option.value > 24 * 60 * 60_000
      || typeof option.label !== "string" || option.label.length === 0)) {
    throw new TypeError("permission duration options are invalid");
  }
  if (onChange !== undefined && typeof onChange !== "function") throw new TypeError("permission change callback is invalid");
  if (onAuditExport !== undefined && typeof onAuditExport !== "function") throw new TypeError("audit export callback is invalid");
  if (typeof clock !== "function") throw new TypeError("permission prompt clock is invalid");

  const document = host.ownerDocument;
  const root = element(document, "div", "clawsembly-permission-prompt");
  root.dataset.permissionPrompt = "";
  const rows = element(document, "div", "permission-prompt-rows");
  const footer = element(document, "div", "permission-prompt-footer");
  const live = element(document, "p", "permission-prompt-live", "Permission requests loaded.");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  const exportButton = element(document, "button", "permission-prompt-export", "Export audit JSON");
  exportButton.type = "button";
  exportButton.dataset.permissionAuditExport = "";
  footer.append(live, exportButton);
  root.append(rows, footer);
  host.replaceChildren(root);

  let expiryTimer;
  let destroyed = false;

  function notify(message) {
    live.textContent = message;
    onChange?.(controller.manifest());
  }

  function runDecision(action, permission, options) {
    try {
      if (action === "approve") controller.approve(permission.capability, permission.scope, options);
      else if (action === "deny") controller.deny(permission.capability, permission.scope);
      else controller.revoke(permission.capability, permission.scope);
      render();
      const outcome = action === "approve" ? "granted" : action === "deny" ? "denied" : "revoked";
      notify(`${permission.capability} is ${outcome}.`);
    } catch (error) {
      live.textContent = error instanceof Error ? error.message : "Permission decision failed.";
    }
  }

  function renderControls(row, permission) {
    const controls = element(document, "div", "permission-controls");
    if (permission.status === "granted") {
      const expiry = element(document, "span", "permission-expiry", `Expires ${formatExpiry(permission.expiresAt)}`);
      const revoke = element(document, "button", "permission-action permission-action-revoke", "Revoke");
      revoke.type = "button";
      revoke.dataset.permissionRevoke = "";
      revoke.setAttribute("aria-label", `Revoke ${permission.capability} for ${permission.scope}`);
      revoke.addEventListener("click", () => runDecision("revoke", permission));
      controls.append(expiry, revoke);
      row.append(controls);
      return;
    }

    const durationLabel = element(document, "label", "permission-field");
    durationLabel.append(element(document, "span", "", "Duration"));
    const duration = document.createElement("select");
    duration.dataset.permissionDuration = "";
    for (const option of durationOptions) {
      const item = document.createElement("option");
      item.value = String(option.value);
      item.textContent = option.label;
      duration.append(item);
    }
    durationLabel.append(duration);

    const callsLabel = element(document, "label", "permission-field");
    callsLabel.append(element(document, "span", "", "Max calls"));
    const calls = document.createElement("input");
    calls.type = "number";
    calls.min = "1";
    calls.max = String(permission.requestedMaxCalls);
    calls.step = "1";
    calls.value = String(permission.requestedMaxCalls);
    calls.dataset.permissionMaxCalls = "";
    callsLabel.append(calls);

    const approve = element(document, "button", "permission-action permission-action-approve", "Approve");
    approve.type = "button";
    approve.dataset.permissionApprove = "";
    approve.setAttribute("aria-label", `Approve ${permission.capability} for ${permission.scope}`);
    approve.addEventListener("click", () => runDecision("approve", permission, {
      durationMs: Number(duration.value),
      maxCalls: Number(calls.value)
    }));

    const deny = element(document, "button", "permission-action permission-action-deny", "Deny");
    deny.type = "button";
    deny.dataset.permissionDeny = "";
    deny.setAttribute("aria-label", `Deny ${permission.capability} for ${permission.scope}`);
    deny.addEventListener("click", () => runDecision("deny", permission));
    controls.append(durationLabel, callsLabel, approve, deny);
    row.append(controls);
  }

  function render() {
    if (destroyed) return;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    const model = buildPermissionPromptModel(controller.manifest(), { now: clock() });
    rows.replaceChildren(...model.permissions.map((permission) => {
      const row = element(document, "article", "permission-row");
      row.dataset.permissionCapability = permission.capability;
      row.dataset.permissionStatus = permission.status;
      const identity = element(document, "div", "permission-identity");
      const state = element(document, "span", "permission-status", permission.statusLabel);
      const capability = element(document, "strong", "", permission.capability);
      const scope = element(document, "code", "", permission.scope);
      const limit = element(document, "small", "", `Requested ceiling · ${permission.requestedMaxCalls} calls`);
      identity.append(state, capability, scope, limit);
      row.append(identity);
      renderControls(row, permission);
      return row;
    }));
    const nextExpiry = model.permissions
      .filter((permission) => permission.status === "granted" && permission.remainingMs !== null)
      .map((permission) => permission.remainingMs)
      .sort((left, right) => left - right)[0];
    if (nextExpiry !== undefined) expiryTimer = setTimeout(render, Math.min(nextExpiry + 20, 2_147_483_647));
    root.dataset.permissionSummary = model.summary;
  }

  exportButton.addEventListener("click", () => {
    const audit = controller.exportAudit();
    onAuditExport?.(audit);
    live.textContent = `Audit exported · ${audit.permissionAudit.events.length} permission events`;
  });

  render();
  return Object.freeze({
    refresh: render,
    exportAudit: () => controller.exportAudit(),
    destroy() {
      destroyed = true;
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      root.remove();
    }
  });
}

export function downloadCapabilityAudit(audit, {
  document = globalThis.document,
  filename = "clawsembly-capability-audit.json"
} = {}) {
  if (!document?.createElement || typeof filename !== "string"
    || !/^[A-Za-z0-9._-]+\.json$/u.test(filename)) {
    throw new TypeError("audit download target is invalid");
  }
  const urlApi = document.defaultView?.URL ?? globalThis.URL;
  const blobApi = document.defaultView?.Blob ?? globalThis.Blob;
  const url = urlApi.createObjectURL(new blobApi([serializeCapabilityAudit(audit)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking in the same microtask can race the download in some engines;
  // a short deferral keeps the blob alive until the save begins.
  const revokeTimer = setTimeout(() => urlApi.revokeObjectURL(url), 10_000);
  revokeTimer?.unref?.();
}

function assertExactKeys(value, allowed, label) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new TypeError(`${label} contains an unknown field`);
  }
}

function normalizeAuditSubject(subject) {
  assertExactKeys(subject, ["artifact", "runtime", "sessionId"], "audit subject");
  assertExactKeys(subject.artifact, ["package", "version", "integrity"], "audit artifact");
  if (!exactPackageName(subject.artifact.package) || typeof subject.artifact.version !== "string"
    || subject.artifact.version.length === 0 || typeof subject.artifact.integrity !== "string"
    || !subject.artifact.integrity.startsWith("sha512-") || subject.runtime !== "browserpod"
    || typeof subject.sessionId !== "string" || !SESSION_PATTERN.test(subject.sessionId)) {
    throw new TypeError("audit subject is invalid");
  }
  return {
    artifact: {
      package: subject.artifact.package,
      version: subject.artifact.version,
      integrity: subject.artifact.integrity
    },
    runtime: "browserpod",
    sessionId: subject.sessionId
  };
}

function normalizeAuditEvent(event, type) {
  const broker = type === "broker";
  const allowed = [
    "schemaVersion", "sequence", "timestamp", "action", "capability", "scope",
    "outcome", "reason", ...(broker ? ["durationMs", "requestId"] : [])
  ];
  assertExactKeys(event, allowed, `${type} audit event`);
  const actions = broker ? ["grant", "revoke", "request"] : ["approve", "deny", "revoke", "expire"];
  if (event.schemaVersion !== 1 || !Number.isSafeInteger(event.sequence) || event.sequence < 1
    || !Number.isFinite(Date.parse(event.timestamp)) || !actions.includes(event.action)
    || typeof event.capability !== "string" || !IDENTIFIER_PATTERN.test(event.capability)
    || typeof event.scope !== "string" || event.scope.length === 0 || event.scope.length > 256
    || typeof event.outcome !== "string" || event.outcome.length === 0
    || typeof event.reason !== "string" || event.reason.length === 0
    || (broker && (typeof event.durationMs !== "number" || !Number.isFinite(event.durationMs) || event.durationMs < 0))
    || (event.requestId !== undefined && (typeof event.requestId !== "string" || !SESSION_PATTERN.test(event.requestId)))) {
    throw new TypeError(`${type} audit event is invalid`);
  }
  return {
    schemaVersion: 1,
    sequence: event.sequence,
    timestamp: event.timestamp,
    action: event.action,
    capability: event.capability,
    scope: event.scope,
    ...(broker ? { durationMs: event.durationMs } : {}),
    ...(broker && event.requestId !== undefined ? { requestId: event.requestId } : {}),
    outcome: event.outcome,
    reason: event.reason
  };
}

export function serializeCapabilityAudit(audit) {
  assertExactKeys(audit, ["schemaVersion", "generatedAt", "subject", "permissionAudit", "brokerAudit"], "audit export");
  assertExactKeys(audit.permissionAudit, ["truncated", "events"], "permission audit");
  assertExactKeys(audit.brokerAudit, ["schemaVersion", "subject", "truncated", "events"], "broker audit");
  if (audit.schemaVersion !== 1 || audit.brokerAudit.schemaVersion !== 1
    || !Number.isFinite(Date.parse(audit.generatedAt))
    || typeof audit.permissionAudit.truncated !== "boolean" || typeof audit.brokerAudit.truncated !== "boolean"
    || !Array.isArray(audit.permissionAudit.events) || audit.permissionAudit.events.length > 100_000
    || !Array.isArray(audit.brokerAudit.events) || audit.brokerAudit.events.length > 100_000) {
    throw new TypeError("audit export is invalid");
  }
  const subject = normalizeAuditSubject(audit.subject);
  const brokerSubject = normalizeAuditSubject(audit.brokerAudit.subject);
  if (JSON.stringify(subject) !== JSON.stringify(brokerSubject)) throw new TypeError("audit subjects do not match");
  const normalized = {
    schemaVersion: 1,
    generatedAt: audit.generatedAt,
    subject,
    permissionAudit: {
      truncated: audit.permissionAudit.truncated,
      events: audit.permissionAudit.events.map((event) => normalizeAuditEvent(event, "permission"))
    },
    brokerAudit: {
      schemaVersion: 1,
      subject: brokerSubject,
      truncated: audit.brokerAudit.truncated,
      events: audit.brokerAudit.events.map((event) => normalizeAuditEvent(event, "broker"))
    }
  };
  return `${JSON.stringify(normalized, null, 2)}\n`;
}
