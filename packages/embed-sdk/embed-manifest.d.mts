import type { CapabilityGrant } from "../capability-broker/capability-broker.mjs";
import type { CompatibilityReportInput, VerifiedCompatibilityReport } from "./report-loader.mjs";

export type { CompatibilityReportInput, VerifiedCompatibilityReport } from "./report-loader.mjs";

export interface EmbedManifest {
  schemaVersion: 1;
  artifact: Readonly<{ package: string; version: string; integrity: string }>;
  runtime: "browserpod";
  runtimeVersion: "2.12.1";
  evidence: Readonly<{
    generatedAt: string;
    reportStatus: CompatibilityReportInput["status"];
    reportRuntime: string;
    reportRuntimeVersion: string | null;
    reportUrl: string | null;
    reportSha256: string | null;
    reportBytes: number | null;
    reportExpiresAt: string | null;
    reportVerified: boolean;
    verifiedForRuntime: boolean;
  }>;
  capabilities: readonly Readonly<Required<Pick<CapabilityGrant, "capability" | "scope" | "maxCalls">>>[];
  launchable: boolean;
  blockers: readonly string[];
}

export function createEmbedManifest(options: {
  report: CompatibilityReportInput | VerifiedCompatibilityReport;
  runtime?: "browserpod";
  capabilities?: CapabilityGrant[];
}): Readonly<EmbedManifest>;

export function assertVerifiedLaunch(manifest: EmbedManifest): Readonly<EmbedManifest>;

export { bootVerifiedEmbed, createArtifactStorageKey } from "./boot.mjs";
