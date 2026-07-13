import assert from "node:assert/strict";
import test from "node:test";

import { buildGatewayPairingPromptModel, mountGatewayPairingPrompt } from "./gateway-pairing-prompt.mjs";

const review = Object.freeze({
  schemaVersion: 1,
  reviewId: "review-1",
  requestId: "pairing-request-1",
  deviceId: "a".repeat(64),
  reason: "scope-upgrade",
  requested: Object.freeze({
    roles: Object.freeze(["operator"]),
    scopes: Object.freeze(["operator.read", "operator.write"])
  }),
  approved: Object.freeze({
    roles: Object.freeze(["operator"]),
    scopes: Object.freeze(["operator.read"])
  }),
  expiresAt: "2026-07-12T00:05:00.000Z"
});

test("builds a bounded pairing prompt model without keys, tokens, or remote metadata", () => {
  const model = buildGatewayPairingPromptModel(review, { now: Date.parse("2026-07-12T00:01:00.000Z") });
  assert.equal(model.reasonLabel, "Scope upgrade");
  assert.equal(model.deviceLabel, `${"a".repeat(12)}…${"a".repeat(8)}`);
  assert.equal(model.remainingMs, 240_000);
  assert.equal(JSON.stringify(model).includes("token"), false);
  assert.equal(JSON.stringify(model).includes("publicKey"), false);
  assert.equal(JSON.stringify(model).includes("remoteIp"), false);
});

test("rejects expired, malformed, and non-DOM pairing prompts", () => {
  assert.throws(() => buildGatewayPairingPromptModel(review, {
    now: Date.parse("2026-07-12T00:05:00.000Z")
  }), /expired/u);
  assert.throws(() => buildGatewayPairingPromptModel({ ...review, deviceId: "short" }), /review is invalid/u);
  assert.throws(() => mountGatewayPairingPrompt({ container: {}, review }), /DOM container/u);
});

function fakeDomContainer() {
  const document = {
    createElement(name) {
      const node = {
        name,
        children: [],
        listeners: new Map(),
        dataset: {},
        className: "",
        textContent: "",
        disabled: false,
        append(...appended) { node.children.push(...appended); },
        setAttribute() {},
        addEventListener(type, listener) { node.listeners.set(type, listener); },
        remove() {},
        click() { node.listeners.get("click")?.(); }
      };
      return node;
    }
  };
  return {
    ownerDocument: document,
    child: undefined,
    replaceChildren(node) { this.child = node; }
  };
}

function findByClass(node, className) {
  if (typeof node.className === "string" && node.className.includes(className)) return node;
  for (const child of node.children ?? []) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return undefined;
}

test("keeps a settled decision when the decision sink throws", async () => {
  const container = fakeDomContainer();
  const deviceId = "a".repeat(64);
  let approvals = 0;
  mountGatewayPairingPrompt({
    container,
    review: {
      schemaVersion: 1,
      reviewId: "review-sink",
      requestId: "request-sink",
      deviceId,
      reason: "not-paired",
      requested: { roles: ["operator"], scopes: ["operator.read"] },
      approved: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    onApprove: async () => {
      approvals += 1;
      return { schemaVersion: 1, decision: "approved", requestId: "request-sink", deviceId };
    },
    onReject: async () => { throw new Error("unused"); },
    onDecision: () => { throw new Error("sink failure must stay diagnostic"); }
  });
  const root = container.child;
  const approve = findByClass(root, "permission-action-approve");
  approve.click();
  for (let attempt = 0; attempt < 20 && root.dataset.pairingState !== "approved"; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(root.dataset.pairingState, "approved");
  approve.click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(approvals, 1);
  assert.equal(approve.disabled, true);
});
