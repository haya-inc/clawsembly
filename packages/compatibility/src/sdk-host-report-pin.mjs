import { createHash } from "node:crypto";
import { assertReport } from "./report.mjs";

export const DEFAULT_REPORT_URL = "https://haya-inc.github.io/clawsembly/data/compatibility.json";
export const DEFAULT_MAX_REPORT_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

function assertUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError("SDK host report pin URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new TypeError("SDK host report pin URL must be credential-free HTTPS without query or fragment");
  }
  return url.href;
}

export function renderSdkHostReportPin(reportSource, {
  url = DEFAULT_REPORT_URL,
  maxAgeMs = DEFAULT_MAX_REPORT_AGE_MS
} = {}) {
  if (typeof reportSource !== "string" || reportSource.length < 2) {
    throw new TypeError("SDK host report source is required");
  }
  let report;
  try { report = assertReport(JSON.parse(reportSource)); }
  catch (error) {
    throw new TypeError(`SDK host report pin cannot use an invalid report: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  if (report.artifact.package !== "openclaw" || report.target.runtime !== "browserpod"
    || typeof report.target.runtimeVersion !== "string" || report.target.runtimeVersion.length === 0) {
    throw new TypeError("SDK host report pin requires exact OpenClaw and BrowserPod identities");
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 60_000 || maxAgeMs > 30 * 24 * 60 * 60 * 1_000) {
    throw new TypeError("SDK host report pin maxAgeMs is invalid");
  }
  const reportUrl = assertUrl(url);
  const sha256 = createHash("sha256").update(reportSource).digest("hex");
  const quote = (value) => JSON.stringify(value);
  return `import type { CompatibilityReportExpectation } from "@haya-inc/clawsembly/report-loader";

export const REPORT_EXPECTATION = {
  url: ${quote(reportUrl)},
  sha256: ${quote(sha256)},
  maxAgeMs: ${maxAgeMs},
  artifact: {
    package: "openclaw",
    version: ${quote(report.artifact.version)},
    integrity: ${quote(report.artifact.integrity)}
  },
  target: {
    runtime: "browserpod",
    runtimeVersion: ${quote(report.target.runtimeVersion)}
  }
} as const satisfies CompatibilityReportExpectation;
`;
}
