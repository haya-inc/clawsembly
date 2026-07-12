import assert from "node:assert/strict";
import test from "node:test";
import { assertPromotionPolicy, formatPromotionPolicy, loadPromotionPolicy } from "./check.mjs";

function policy(overrides = {}) {
  const gate = (channel) => ({
    channel,
    version: "1.0.0",
    eligible: true,
    reasons: [],
    observations: {
      status: "supported",
      runtimeEvidence: true,
      checks: { pass: 10, warn: 0, fail: 0, pending: 0 },
      shrinkwrapConsistent: true,
      gatewayClassification: channel === "stable" ? "unchanged" : "additive",
      dependencyRiskCount: 0,
      truncatedDependencyRiskCount: 0
    }
  });
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-12T00:00:00.000Z",
    package: "openclaw",
    decision: "promote",
    baseline: gate("stable"),
    candidate: gate("preview"),
    rollback: gate("previous"),
    ...overrides
  };
}

function response(value, options = {}) {
  return new Response(JSON.stringify(value), {
    status: options.status ?? 200,
    headers: { "content-type": options.contentType ?? "application/json" }
  });
}

test("loads and formats a strict credential-free HTTPS policy", async () => {
  let request;
  const loaded = await loadPromotionPolicy({
    url: "https://example.com/promotion-policy.json",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response(policy());
    }
  });
  assert.equal(loaded.decision, "promote");
  assert.equal(formatPromotionPolicy(loaded), "OpenClaw 1.0.0: PROMOTE (none)");
  assert.equal(request.url, "https://example.com/promotion-policy.json");
  assert.equal(request.options.redirect, "error");
});

test("accepts a self-consistent hold and rejects contradictory decisions", () => {
  const held = policy({
    decision: "hold",
    candidate: {
      channel: "preview", version: "2.0.0-beta.1", eligible: false,
      reasons: ["gateway-contract-breaking"],
      observations: {
        status: "supported",
        runtimeEvidence: true,
        checks: { pass: 10, warn: 0, fail: 0, pending: 0 },
        shrinkwrapConsistent: true,
        gatewayClassification: "breaking",
        dependencyRiskCount: 0,
        truncatedDependencyRiskCount: 0
      }
    }
  });
  assert.equal(assertPromotionPolicy(held), held);
  assert.equal(formatPromotionPolicy(held), "OpenClaw 2.0.0-beta.1: HOLD (gateway-contract-breaking)");
  assert.throws(() => assertPromotionPolicy({ ...held, decision: "promote" }), /contradicts/u);
  assert.throws(() => assertPromotionPolicy({
    ...held,
    candidate: { ...held.candidate, reasons: [] }
  }), /contradicts its observations/u);
});

test("rejects unsafe aliases, non-JSON responses, and oversized bodies", async () => {
  await assert.rejects(
    loadPromotionPolicy({ url: "http://example.com/policy.json", fetchImpl: async () => response(policy()) }),
    /credential-free HTTPS/u
  );
  await assert.rejects(
    loadPromotionPolicy({
      url: "https://example.com/policy.json?latest=true",
      fetchImpl: async () => response(policy())
    }),
    /query or fragment/u
  );
  await assert.rejects(
    loadPromotionPolicy({
      url: "https://example.com/policy.json",
      fetchImpl: async () => response(policy(), { contentType: "text/html" })
    }),
    /not JSON/u
  );
  await assert.rejects(
    loadPromotionPolicy({
      url: "https://example.com/policy.json",
      fetchImpl: async () => new Response("x", {
        headers: { "content-type": "application/json", "content-length": String(1024 * 1024 + 1) }
      })
    }),
    /exceeds 1 MiB/u
  );
});
