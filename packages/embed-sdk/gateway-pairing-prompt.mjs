const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;
const DEVICE_ID = /^[a-f0-9]{64}$/u;
const REASONS = Object.freeze({
  "not-paired": "New browser device",
  "role-upgrade": "Role upgrade",
  "scope-upgrade": "Scope upgrade",
  "metadata-upgrade": "Device metadata changed"
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function strings(value, label, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > 64
    || value.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 512
      || /[\0\r\n]/u.test(entry))) {
    throw new TypeError(`${label} is invalid`);
  }
  return Object.freeze([...value]);
}

function access(value, label, nullable = false) {
  if (nullable && value === null) return null;
  if (!isRecord(value)) throw new TypeError(`${label} is invalid`);
  return Object.freeze({
    roles: strings(value.roles, `${label} roles`, { min: nullable ? 0 : 1 }),
    scopes: strings(value.scopes, `${label} scopes`, { min: nullable ? 0 : 1 })
  });
}

export function buildGatewayPairingPromptModel(review, { now = Date.now() } = {}) {
  if (!isRecord(review) || review.schemaVersion !== 1 || !REQUEST_ID.test(review.reviewId ?? "")
    || !REQUEST_ID.test(review.requestId ?? "") || !DEVICE_ID.test(review.deviceId ?? "")
    || !Object.hasOwn(REASONS, review.reason) || !Number.isFinite(Date.parse(review.expiresAt))
    || !Number.isFinite(now)) {
    throw new TypeError("Gateway pairing review is invalid");
  }
  const expiresAtMs = Date.parse(review.expiresAt);
  if (expiresAtMs <= now) throw new TypeError("Gateway pairing review has expired");
  return Object.freeze({
    reviewId: review.reviewId,
    requestId: review.requestId,
    deviceId: review.deviceId,
    deviceLabel: `${review.deviceId.slice(0, 12)}…${review.deviceId.slice(-8)}`,
    reason: review.reason,
    reasonLabel: REASONS[review.reason],
    requested: access(review.requested, "requested pairing access"),
    approved: access(review.approved, "approved pairing access", true),
    expiresAt: review.expiresAt,
    remainingMs: expiresAtMs - now
  });
}

function element(document, name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function assertDecision(value, model, decision) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.decision !== decision
    || value.requestId !== model.requestId || value.deviceId !== model.deviceId) {
    throw new Error("Gateway pairing decision did not match the reviewed request");
  }
  return value;
}

export function mountGatewayPairingPrompt({
  container,
  review,
  onApprove,
  onReject,
  onDecision,
  clock = Date.now
}) {
  if (!container || typeof container.replaceChildren !== "function" || !container.ownerDocument
    || typeof container.ownerDocument.createElement !== "function") {
    throw new TypeError("a DOM container is required for the Gateway pairing prompt");
  }
  if (typeof onApprove !== "function" || typeof onReject !== "function") {
    throw new TypeError("Gateway pairing prompt decision handlers are required");
  }
  if (onDecision !== undefined && typeof onDecision !== "function") {
    throw new TypeError("Gateway pairing prompt decision sink is invalid");
  }
  if (typeof clock !== "function") throw new TypeError("Gateway pairing prompt clock is invalid");
  const model = buildGatewayPairingPromptModel(review, { now: clock() });
  const document = container.ownerDocument;
  const root = element(document, "section", "clawsembly-pairing-prompt");
  root.dataset.pairingPrompt = "";
  root.dataset.pairingState = "pending";

  const header = element(document, "div", "pairing-prompt-head");
  const title = element(document, "strong", "", "Gateway pairing approval");
  const reason = element(document, "span", "pairing-reason", model.reasonLabel);
  header.append(title, reason);

  const identity = element(document, "div", "pairing-device");
  identity.append(
    element(document, "span", "", "Signed browser device"),
    element(document, "code", "", model.deviceLabel)
  );

  const requested = element(document, "div", "pairing-access");
  requested.append(
    element(document, "span", "", "Requested access"),
    element(document, "strong", "", model.requested.roles.join(" · ")),
    element(document, "code", "", model.requested.scopes.join(" · "))
  );
  if (model.approved) {
    const approved = element(document, "div", "pairing-access pairing-access-approved");
    approved.append(
      element(document, "span", "", "Currently approved"),
      element(document, "strong", "", model.approved.roles.join(" · ") || "none"),
      element(document, "code", "", model.approved.scopes.join(" · ") || "none")
    );
    requested.append(approved);
  }

  const controls = element(document, "div", "pairing-actions");
  const approve = element(document, "button", "permission-action permission-action-approve", "Approve exact request");
  approve.type = "button";
  approve.dataset.pairingApprove = "";
  const reject = element(document, "button", "permission-action permission-action-deny", "Reject");
  reject.type = "button";
  reject.dataset.pairingReject = "";
  const live = element(document, "p", "pairing-live", "Waiting for an explicit owner decision.");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  controls.append(approve, reject);
  root.append(header, identity, requested, controls, live);
  container.replaceChildren(root);

  let decided = false;
  let destroyed = false;
  async function decide(decision) {
    if (decided || destroyed) return;
    decided = true;
    approve.disabled = true;
    reject.disabled = true;
    root.dataset.pairingState = "deciding";
    live.textContent = decision === "approved" ? "Approving the reviewed request…" : "Rejecting the reviewed request…";
    let result;
    try {
      result = assertDecision(
        await (decision === "approved" ? onApprove(model.reviewId) : onReject(model.reviewId)),
        model,
        decision
      );
    } catch {
      decided = false;
      approve.disabled = false;
      reject.disabled = false;
      root.dataset.pairingState = "failed";
      live.textContent = "Pairing decision failed. Refresh the pending request before retrying.";
      return;
    }
    root.dataset.pairingState = decision;
    live.textContent = decision === "approved"
      ? "Approved. Reconnect to receive an encrypted device token."
      : "Rejected. The pending request cannot authenticate.";
    // The decision is already executed; a throwing consumer sink must not
    // re-arm the buttons into a second decision.
    try { onDecision?.(Object.freeze({ decision, requestId: result.requestId, deviceId: result.deviceId })); }
    catch { /* diagnostic sink only */ }
  }
  approve.addEventListener("click", () => { void decide("approved"); });
  reject.addEventListener("click", () => { void decide("rejected"); });

  return Object.freeze({
    model,
    destroy() {
      if (destroyed) return false;
      destroyed = true;
      root.remove();
      return true;
    }
  });
}
