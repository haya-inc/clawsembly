import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { loadVerifiedCompatibilityReport } from "./report-loader.mjs";

const INTEGRITY = `sha512-${"A".repeat(86)}==`;

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: "probing",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    evidence: [],
    checks: [{ id: "runtime", status: "pending" }],
    ...overrides
  };
}

function source(value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  return {
    body,
    sha256: createHash("sha256").update(body).digest("hex")
  };
}

function expectation(sha256, overrides = {}) {
  return {
    url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
    sha256,
    maxAgeMs: 24 * 60 * 60 * 1_000,
    artifact: { package: "openclaw", version: "2026.6.11", integrity: INTEGRITY },
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" },
    ...overrides
  };
}

function response(body, options = {}) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      "content-type": options.contentType ?? "application/json; charset=utf-8",
      "content-length": String(options.contentLength ?? new TextEncoder().encode(body).byteLength)
    }
  });
}

test("loads only the exact HTTPS report bytes and returns a branded frozen result", async () => {
  const exact = source(report());
  let request;
  const verified = await loadVerifiedCompatibilityReport(expectation(exact.sha256), {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(exact.body);
    }
  });

  assert.equal(verified.report.status, "probing");
  assert.equal(verified.verification.sha256, exact.sha256);
  assert.equal(verified.verification.bytes, new TextEncoder().encode(exact.body).byteLength);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.report), true);
  assert.deepEqual(request, {
    url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
    init: { cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer" }
  });
});

test("rejects byte drift, artifact drift, and unsupported source URLs", async () => {
  const exact = source(report());
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation("0".repeat(64)), { fetchImpl: async () => response(exact.body) }),
    /SHA-256/u
  );

  const changed = source(report({ artifact: { package: "openclaw", version: "2026.7.0", integrity: INTEGRITY } }));
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(changed.sha256), { fetchImpl: async () => response(changed.body) }),
    /artifact identity/u
  );

  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(exact.sha256, { url: "http://example.com/report.json" })),
    /credential-free HTTPS/u
  );
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(exact.sha256, { url: "https://example.com/report.json?latest=1" })),
    /credential-free HTTPS/u
  );
});

test("rejects unsafe response metadata, oversized bodies, and inconsistent supported claims", async () => {
  const exact = source(report());
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(exact.sha256), {
      fetchImpl: async () => response(exact.body, { contentType: "text/plain" })
    }),
    /content type/u
  );
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(exact.sha256), {
      fetchImpl: async () => response(exact.body, { contentLength: 2_000_000 })
    }),
    /byte limit/u
  );
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(exact.sha256), {
      fetchImpl: async () => new Response("x".repeat(1_000_001), {
        headers: { "content-type": "application/json" }
      })
    }),
    /byte limit/u
  );

  const unsupported = source(report({ status: "supported", checks: [{ id: "runtime", status: "pass" }] }));
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(unsupported.sha256), {
      fetchImpl: async () => response(unsupported.body)
    }),
    /supported runtime evidence/u
  );
});

test("rejects stale and implausibly future-dated report bytes", async () => {
  const stale = source(report({ generatedAt: "2026-07-01T00:00:00.000Z" }));
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(stale.sha256), {
      fetchImpl: async () => response(stale.body),
      now: () => Date.parse("2026-07-12T00:00:00.000Z")
    }),
    /freshness window/u
  );

  const future = source(report({ generatedAt: "2026-07-13T00:00:00.000Z" }));
  await assert.rejects(
    loadVerifiedCompatibilityReport(expectation(future.sha256), {
      fetchImpl: async () => response(future.body),
      now: () => Date.parse("2026-07-12T00:00:00.000Z")
    }),
    /freshness window/u
  );
});
