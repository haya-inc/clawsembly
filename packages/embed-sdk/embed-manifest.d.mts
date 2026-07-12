import type { CapabilityGrant } from "../capability-broker/capability-broker.mjs";

export interface CompatibilityReportInput {
  generatedAt: string;
  status: "probing" | "partial" | "supported" | "unsupported";
  target: { runtime: string };
  artifact: { package: "openclaw"; version: string; integrity: string };
}

export interface EmbedManifest {
  schemaVersion: 1;
  artifact: Readonly<{ package: "openclaw"; version: string; integrity: string }>;
  runtime: "browserpod";
  evidence: Readonly<{
    generatedAt: string;
    reportStatus: CompatibilityReportInput["status"];
    reportRuntime: string;
    verifiedForRuntime: boolean;
  }>;
  capabilities: readonly Readonly<Required<Pick<CapabilityGrant, "capability" | "scope" | "maxCalls">>>[];
  launchable: boolean;
  blockers: readonly string[];
}

export function createEmbedManifest(options: {
  report: CompatibilityReportInput;
  runtime?: "browserpod";
  capabilities?: CapabilityGrant[];
}): Readonly<EmbedManifest>;

export function assertVerifiedLaunch(manifest: EmbedManifest): Readonly<EmbedManifest>;
