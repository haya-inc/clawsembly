export interface CompatibilityReportInput {
  schemaVersion: 1;
  generatedAt: string;
  status: "probing" | "partial" | "supported" | "unsupported";
  target: { runtime: string; runtimeVersion?: string; browserBaseline?: string };
  artifact: { package: "openclaw"; version: string; integrity: string };
  evidence?: Array<{ id: string; kind: string; path: string; sha256: string }>;
  checks?: Array<{ id: string; status: "pass" | "warn" | "fail" | "pending" }>;
}

export interface CompatibilityReportExpectation {
  readonly url: string;
  readonly sha256: string;
  readonly maxAgeMs: number;
  readonly artifact: Readonly<{
    package: "openclaw";
    version: string;
    integrity: string;
  }>;
  readonly target: Readonly<{
    runtime: "browserpod";
    runtimeVersion: string;
  }>;
}

export interface VerifiedCompatibilityReport {
  readonly report: Readonly<CompatibilityReportInput>;
  readonly verification: Readonly<{
    url: string;
    sha256: string;
    bytes: number;
    verifiedAt: string;
    expiresAt: string;
  }>;
}

export function loadVerifiedCompatibilityReport(
  expectation: CompatibilityReportExpectation,
  options?: {
    fetchImpl?: typeof fetch;
    cryptoApi?: Crypto;
    maxBytes?: number;
    now?: () => number;
  }
): Promise<VerifiedCompatibilityReport>;
