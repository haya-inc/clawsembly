import {
  assertVerifiedLaunch,
  createEmbedManifest,
  type EmbedManifest
} from "@haya-inc/clawsembly";
import type { VerifiedCompatibilityReport } from "@haya-inc/clawsembly/report-loader";

export interface LaunchDecision {
  readonly state: "blocked" | "ready";
  readonly summary: string;
  readonly manifest: Readonly<EmbedManifest>;
  readonly reportSha256: string;
}

export function inspectLaunchReport(verifiedReport: VerifiedCompatibilityReport): LaunchDecision {
  const manifest = createEmbedManifest({ report: verifiedReport, capabilities: [] });
  try {
    assertVerifiedLaunch(manifest);
    return Object.freeze({
      state: "ready",
      summary: "Evidence is accepted. Provider boot still requires an explicit owner action.",
      manifest,
      reportSha256: verifiedReport.verification.sha256
    });
  } catch {
    return Object.freeze({
      state: "blocked",
      summary: "Evidence does not authorize BrowserPod boot. No provider token was consumed.",
      manifest,
      reportSha256: verifiedReport.verification.sha256
    });
  }
}
