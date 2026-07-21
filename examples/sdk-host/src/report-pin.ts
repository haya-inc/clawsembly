import type { CompatibilityReportExpectation } from "@haya-inc/clawsembly/report-loader";

export const REPORT_EXPECTATION = {
  url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
  sha256: "ed5b8454b32149d4eef348590be032ae6c6042e0587f7b65db5b00096187a031",
  maxAgeMs: 604800000,
  artifact: {
    package: "openclaw",
    version: "2026.7.1-2",
    integrity: "sha512-ycF3yPcbjN6bUPeaUx6Mh6vze1hQWoD3CT/wWcmD7a8xaHHHRUaAlaq+lFxMHf1ssEgODVAwjlzYqp2twkYZ7g=="
  },
  target: {
    runtime: "browserpod",
    runtimeVersion: "2.12.1"
  }
} as const satisfies CompatibilityReportExpectation;
