import type { CompatibilityReportExpectation } from "@haya-inc/clawsembly/report-loader";

export const REPORT_EXPECTATION = {
  url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
  sha256: "f36784e499894446f806bbf07fbe5d5023d8037e0181da6c2030e3822c2d3e19",
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
