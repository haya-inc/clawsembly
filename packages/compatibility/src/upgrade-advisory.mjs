// Operator upgrade advisories (ADR 0006, decision 1.iii): translate the
// tracked release history, contract diffs, dependency risk, and promotion
// decision into one bounded advisory per upgrade path an operator actually
// faces. The advisory is fully derived from committed inputs — the
// validator recomputes it, so it can never silently drift or go stale.

const CHANNELS = ["stable", "previous", "preview"];
const VERDICTS = new Set(["hold", "review-required", "routine"]);
const SAMPLE_LIMIT = 16;

function requireEntry(history, channel) {
  const entry = history?.releases?.find((release) => release.channel === channel);
  if (!entry || typeof entry.version !== "string" || !entry.version
    || !entry.artifact || !entry.checks || !entry.gatewayContractFromStable
    || !Array.isArray(entry.dependencyRiskFromStable)
    || typeof entry.reportPath !== "string") {
    throw new Error(`upgrade advisories require a complete ${channel} release summary`);
  }
  return entry;
}

function nodeEngineOf(reportsByPath, entry) {
  const report = reportsByPath?.get?.(entry.reportPath);
  const nodeEngine = report?.artifact?.nodeEngine;
  if (typeof nodeEngine !== "string" || nodeEngine.length === 0 || nodeEngine.length > 256) {
    throw new Error(`upgrade advisories require the ${entry.channel} report's engines declaration`);
  }
  return nodeEngine;
}

function side(entry, nodeEngine) {
  return {
    channel: entry.channel,
    version: entry.version,
    status: entry.status,
    runtimeEvidence: entry.runtimeEvidence === true,
    upstreamPublishedAt: entry.upstreamPublishedAt,
    reportPath: entry.reportPath,
    nodeEngine,
    checks: { ...entry.checks }
  };
}

function sampled(values) {
  const list = Array.isArray(values) ? values : [];
  return {
    count: list.length,
    sample: Object.freeze(list.slice(0, SAMPLE_LIMIT))
  };
}

function surfaceFromDiff(diff) {
  return {
    classification: diff.classification,
    protocolChanged: diff.protocol?.changed === true,
    coreMethods: {
      added: sampled(diff.coreMethods?.added),
      removed: sampled(diff.coreMethods?.removed)
    },
    schemaExports: {
      addedCount: Array.isArray(diff.schemaExports?.added) ? diff.schemaExports.added.length : 0,
      removedCount: Array.isArray(diff.schemaExports?.removed) ? diff.schemaExports.removed.length : 0
    },
    eventSchemas: {
      addedCount: Array.isArray(diff.eventSchemas?.added) ? diff.eventSchemas.added.length : 0,
      removedCount: Array.isArray(diff.eventSchemas?.removed) ? diff.eventSchemas.removed.length : 0
    }
  };
}

function adviseOne({ from, to, diffEntry, direction, promotionDecision }) {
  // The tracker computes every diff relative to stable; the previous→stable
  // path therefore reads the previous entry's diff in reverse.
  const diff = diffEntry.gatewayContractFromStable;
  const reversed = direction === "to-stable";
  const surface = surfaceFromDiff(diff);
  const orientedSurface = reversed
    ? {
      ...surface,
      coreMethods: { added: surface.coreMethods.removed, removed: surface.coreMethods.added },
      schemaExports: {
        addedCount: surface.schemaExports.removedCount,
        removedCount: surface.schemaExports.addedCount
      },
      eventSchemas: {
        addedCount: surface.eventSchemas.removedCount,
        removedCount: surface.eventSchemas.addedCount
      }
    }
    : surface;

  const dependencyChanges = diffEntry.dependencyChangesFromStable ?? {};
  const dependencies = {
    addedCount: Array.isArray(dependencyChanges.added) ? dependencyChanges.added.length : 0,
    removedCount: Array.isArray(dependencyChanges.removed) ? dependencyChanges.removed.length : 0,
    changedCount: Array.isArray(dependencyChanges.changed) ? dependencyChanges.changed.length : 0,
    riskFindingCount: diffEntry.dependencyRiskFromStable.length,
    truncatedRiskScanCount: diffEntry.dependencyRiskFromStable
      .filter((risk) => risk?.scan?.truncated === true).length
  };
  if (reversed) {
    const added = dependencies.addedCount;
    dependencies.addedCount = dependencies.removedCount;
    dependencies.removedCount = added;
  }

  const reasons = [];
  if (surface.classification === "breaking") reasons.push("gateway-contract-breaking");
  if (surface.classification === "incomplete") reasons.push("gateway-contract-inspection-incomplete");
  if (from.nodeEngine !== to.nodeEngine) reasons.push("node-engines-changed");
  if (to.status !== "supported") reasons.push("target-status-not-supported");
  if (to.runtimeEvidence !== true) reasons.push("target-runtime-evidence-missing");
  if (to.checks.fail > 0) reasons.push("target-checks-failed");
  if (to.checks.pending > 0) reasons.push("target-checks-pending");
  if (dependencies.truncatedRiskScanCount > 0) reasons.push("dependency-risk-scan-truncated");
  if (dependencies.riskFindingCount > 0) reasons.push("dependency-risk-findings-present");

  let verdict = "routine";
  if (reasons.length > 0) verdict = "review-required";
  if (direction === "to-preview" && promotionDecision !== "promote") {
    verdict = "hold";
    reasons.push("promotion-policy-holds");
  }

  return {
    path: `${from.channel}->${to.channel}`,
    from,
    to,
    verdict,
    reasons: Object.freeze([...new Set(reasons)]),
    surface: orientedSurface,
    dependencies,
    ...(reversed ? {} : { footprintDelta: { ...diffEntry.deltaFromStable } })
  };
}

/**
 * Builds the advisory document from the committed release history, the
 * committed promotion policy decision, and the per-release reports (for the
 * engines declarations). Deterministic: generatedAt is the history's own
 * timestamp, never the wall clock.
 */
export function buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath } = {}) {
  if (history?.schemaVersion !== 1 || typeof history.generatedAt !== "string") {
    throw new Error("upgrade advisories require the tracked release history");
  }
  if (typeof promotionPolicy?.decision !== "string") {
    throw new Error("upgrade advisories require the promotion policy decision");
  }
  const entries = Object.fromEntries(CHANNELS.map((channel) => [channel, requireEntry(history, channel)]));
  const engines = Object.fromEntries(CHANNELS.map((channel) => [
    channel,
    nodeEngineOf(reportsByPath, entries[channel])
  ]));
  const sides = Object.fromEntries(CHANNELS.map((channel) => [
    channel,
    side(entries[channel], engines[channel])
  ]));

  const record = {
    schemaVersion: 1,
    generatedAt: history.generatedAt,
    package: history.package,
    promotionDecision: promotionPolicy.decision,
    advisories: [
      adviseOne({
        from: sides.previous,
        to: sides.stable,
        diffEntry: entries.previous,
        direction: "to-stable",
        promotionDecision: promotionPolicy.decision
      }),
      adviseOne({
        from: sides.stable,
        to: sides.preview,
        diffEntry: entries.preview,
        direction: "to-preview",
        promotionDecision: promotionPolicy.decision
      })
    ]
  };
  return record;
}

/** Fail-closed shape check for a committed advisory document. */
export function assertUpgradeAdvisory(advisory) {
  if (advisory?.schemaVersion !== 1 || typeof advisory.generatedAt !== "string"
    || typeof advisory.package !== "string"
    || typeof advisory.promotionDecision !== "string"
    || !Array.isArray(advisory.advisories) || advisory.advisories.length !== 2) {
    throw new Error("upgrade advisory document is invalid");
  }
  for (const entry of advisory.advisories) {
    if (typeof entry.path !== "string" || !VERDICTS.has(entry.verdict)
      || !Array.isArray(entry.reasons) || entry.reasons.length > 32
      || !entry.from || !entry.to || !entry.surface || !entry.dependencies
      || typeof entry.from.nodeEngine !== "string" || typeof entry.to.nodeEngine !== "string"
      || entry.surface.coreMethods.added.sample.length > SAMPLE_LIMIT
      || entry.surface.coreMethods.removed.sample.length > SAMPLE_LIMIT) {
      throw new Error(`upgrade advisory entry ${entry?.path ?? "?"} is invalid`);
    }
  }
  return advisory;
}
