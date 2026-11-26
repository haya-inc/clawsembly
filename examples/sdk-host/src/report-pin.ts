import type { CompatibilityReportExpectation } from "@haya-inc/clawsembly/report-loader";

export const REPORT_EXPECTATION = {
  url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
  sha256: "25c045ff36c2c59c5723e57c3aa821c30717e3f15a8481e2232d26bb505a5b41",
  maxAgeMs: 604800000,
  artifact: {
    package: "openclaw",
    version: "2026.11.10",
    integrity: "sha512-/FKDjxY1ZdUSXHx1a9b4EUpPRZywM3uv4181g22XImJfp/5+h+fFUZ7B7HthNrdYzq//05zH0Yf7mefzIlWFaQ=="
  },
  target: {
    runtime: "browserpod",
    runtimeVersion: "2.12.1"
  }
} as const satisfies CompatibilityReportExpectation;
