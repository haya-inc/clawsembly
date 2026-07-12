import type { CompatibilityReportExpectation } from "@haya-inc/clawsembly/report-loader";

export const REPORT_EXPECTATION = {
  url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
  sha256: "9316f7707eddd513af57010ac18b24c90ace9359be0f5c8c46254753bcaaa52f",
  maxAgeMs: 604800000,
  artifact: {
    package: "openclaw",
    version: "2026.6.11",
    integrity: "sha512-T+P/g19IheeT1ckXMoPN61dYuE8vBF4MderI+kWkvpuFYxPkJxn8AXLpu9IXCnN9g36Acpm9+mMD/V+lsvOkyA=="
  },
  target: {
    runtime: "browserpod",
    runtimeVersion: "2.12.1"
  }
} as const satisfies CompatibilityReportExpectation;
