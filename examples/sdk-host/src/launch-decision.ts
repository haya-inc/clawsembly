import {
  assertVerifiedLaunch,
  createEmbedManifest,
  type CompatibilityReportInput,
  type EmbedManifest
} from "@haya-inc/clawsembly";

export interface LaunchDecision {
  readonly state: "blocked" | "ready";
  readonly summary: string;
  readonly manifest: Readonly<EmbedManifest>;
}

export function inspectLaunchReport(report: CompatibilityReportInput): LaunchDecision {
  const manifest = createEmbedManifest({ report, capabilities: [] });
  try {
    assertVerifiedLaunch(manifest);
    return Object.freeze({
      state: "ready",
      summary: "Evidence is accepted. Provider boot still requires an explicit owner action.",
      manifest
    });
  } catch {
    return Object.freeze({
      state: "blocked",
      summary: "Evidence does not authorize BrowserPod boot. No provider token was consumed.",
      manifest
    });
  }
}
