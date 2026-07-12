const BLOCKING_GATEWAY_CLASSIFICATIONS = new Set(["breaking", "incomplete"]);

function requireRelease(release, channel) {
  if (!release || release.channel !== channel || typeof release.version !== "string"
    || !release.version || !release.artifact || !release.checks
    || !release.gatewayContractFromStable || !Array.isArray(release.dependencyRiskFromStable)) {
    throw new Error(`Promotion policy requires a complete ${channel} release summary.`);
  }
  return release;
}

function releaseGate(release) {
  const reasons = [];
  if (release.status !== "supported") reasons.push("status-not-supported");
  if (release.runtimeEvidence !== true) reasons.push("runtime-evidence-missing");
  if (release.checks.fail > 0) reasons.push("checks-failed");
  if (release.checks.pending > 0) reasons.push("checks-pending");
  if (release.artifact.shrinkwrapConsistent !== true) reasons.push("shrinkwrap-inconsistent");
  const gatewayClassification = release.gatewayContractFromStable.classification;
  if (gatewayClassification === "breaking") reasons.push("gateway-contract-breaking");
  if (gatewayClassification === "incomplete") reasons.push("gateway-contract-incomplete");
  const truncatedDependencyRiskCount = release.dependencyRiskFromStable
    .filter((risk) => risk?.scan?.truncated === true).length;
  if (truncatedDependencyRiskCount > 0) reasons.push("dependency-risk-scan-truncated");
  const uniqueReasons = [...new Set(reasons)];
  return {
    channel: release.channel,
    version: release.version,
    eligible: uniqueReasons.length === 0,
    reasons: uniqueReasons,
    observations: {
      status: release.status,
      runtimeEvidence: release.runtimeEvidence,
      checks: release.checks,
      shrinkwrapConsistent: release.artifact.shrinkwrapConsistent,
      gatewayClassification,
      dependencyRiskCount: release.dependencyRiskFromStable.length,
      truncatedDependencyRiskCount
    }
  };
}

export function buildPromotionPolicy(history) {
  if (history?.schemaVersion !== 1 || typeof history?.generatedAt !== "string"
    || typeof history?.package !== "string" || !Array.isArray(history?.releases)) {
    throw new Error("Promotion policy requires a version 1 release history.");
  }
  const byChannel = new Map(history.releases.map((release) => [release.channel, release]));
  const baseline = releaseGate(requireRelease(byChannel.get("stable"), "stable"));
  const candidate = releaseGate(requireRelease(byChannel.get("preview"), "preview"));
  const rollback = releaseGate(requireRelease(byChannel.get("previous"), "previous"));
  return {
    schemaVersion: 1,
    generatedAt: history.generatedAt,
    package: history.package,
    decision: candidate.eligible ? "promote" : "hold",
    baseline,
    candidate,
    rollback
  };
}

export function isBlockingGatewayClassification(classification) {
  return BLOCKING_GATEWAY_CLASSIFICATIONS.has(classification);
}
