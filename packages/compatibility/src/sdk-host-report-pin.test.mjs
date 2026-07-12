import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { renderSdkHostReportPin } from "./sdk-host-report-pin.mjs";

function report(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-12T00:00:00.000Z",
    status: "probing",
    target: { runtime: "browserpod", runtimeVersion: "2.12.1", browserBaseline: "Desktop Chromium" },
    artifact: {
      package: "openclaw",
      version: "2026.6.11",
      integrity: `sha512-${"A".repeat(86)}==`
    },
    evidence: [],
    checks: [{ id: "runtime", status: "pending" }],
    ...overrides
  };
}

test("renders an exact raw-byte report pin deterministically", () => {
  const source = `${JSON.stringify(report(), null, 2)}\n`;
  const pin = renderSdkHostReportPin(source);
  assert.equal(pin, renderSdkHostReportPin(source));
  assert.match(pin, new RegExp(createHash("sha256").update(source).digest("hex"), "u"));
  assert.match(pin, /version: "2026\.6\.11"/u);
  assert.match(pin, /runtimeVersion: "2\.12\.1"/u);
  assert.match(pin, /maxAgeMs: 604800000/u);
});

test("raw formatting changes the reviewed pin", () => {
  const compact = JSON.stringify(report());
  const formatted = `${JSON.stringify(report(), null, 2)}\n`;
  assert.notEqual(renderSdkHostReportPin(compact), renderSdkHostReportPin(formatted));
});

test("rejects unsafe URLs, invalid age policy, and non-BrowserPod reports", () => {
  const source = `${JSON.stringify(report())}\n`;
  assert.throws(
    () => renderSdkHostReportPin(source, { url: "http://example.com/report.json" }),
    /credential-free HTTPS/u
  );
  assert.throws(() => renderSdkHostReportPin(source, { maxAgeMs: 1 }), /maxAgeMs/u);
  assert.throws(
    () => renderSdkHostReportPin(`${JSON.stringify(report({
      target: { runtime: "remote", runtimeVersion: "1", browserBaseline: "server" }
    }))}\n`),
    /BrowserPod-only/u
  );
});
