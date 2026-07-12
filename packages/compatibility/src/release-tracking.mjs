const CHANNEL_ORDER = ["stable", "previous", "preview"];

function isPrerelease(version) {
  return String(version).includes("-");
}

export function resolveReleaseChannels(distTags = {}, versions = []) {
  const stable = String(distTags.latest ?? "");
  if (!stable || !versions.includes(stable)) {
    throw new Error("The npm latest dist-tag does not resolve to a published version.");
  }

  const stableIndex = versions.lastIndexOf(stable);
  const previous = versions
    .slice(0, stableIndex)
    .reverse()
    .find((version) => !isPrerelease(version));
  if (!previous) throw new Error(`No previous stable release exists before ${stable}.`);

  const taggedPreview = typeof distTags.beta === "string" && distTags.beta !== stable
    ? distTags.beta
    : undefined;
  const preview = taggedPreview && versions.includes(taggedPreview)
    ? taggedPreview
    : versions.toReversed().find((version) => isPrerelease(version) && version !== stable);
  if (!preview) throw new Error("No published preview release could be resolved.");

  return { stable, previous, preview };
}

function countStatuses(checks = []) {
  return checks.reduce((counts, check) => {
    if (check.status in counts) counts[check.status] += 1;
    return counts;
  }, { pass: 0, warn: 0, fail: 0, pending: 0 });
}

function dependencyMap(dependencies, label) {
  if (!Array.isArray(dependencies)) throw new Error(`${label} direct dependency inventory is missing.`);
  const entries = new Map();
  for (const dependency of dependencies) {
    if (!dependency?.name || typeof dependency.spec !== "string" || dependency.spec.length === 0) {
      throw new Error(`${label} direct dependency inventory is invalid.`);
    }
    if (entries.has(dependency.name)) throw new Error(`${label} direct dependency inventory contains duplicates.`);
    entries.set(dependency.name, dependency.spec);
  }
  return entries;
}

export function compareDirectDependencies(stableDependencies, releaseDependencies) {
  const stable = dependencyMap(stableDependencies, "Stable");
  const release = dependencyMap(releaseDependencies, "Release");
  const added = [];
  const removed = [];
  const changed = [];
  for (const [name, spec] of release) {
    if (!stable.has(name)) added.push({ name, spec });
    else if (stable.get(name) !== spec) changed.push({ name, stableSpec: stable.get(name), releaseSpec: spec });
  }
  for (const [name, spec] of stable) {
    if (!release.has(name)) removed.push({ name, spec });
  }
  const byName = (left, right) => left.name.localeCompare(right.name);
  return {
    added: added.sort(byName),
    removed: removed.sort(byName),
    changed: changed.sort(byName)
  };
}

function summarizeReport(channel, report, reportPath, stableReport) {
  const shrinkwrap = report.artifact.shrinkwrapRootConsistency;
  const stableArtifact = stableReport.artifact;
  return {
    channel,
    version: report.artifact.version,
    status: report.status,
    reportPath,
    generatedAt: report.generatedAt,
    runtimeEvidence: report.evidence.some((item) => item.id === "browserpod-runtime"),
    artifact: {
      integrity: report.artifact.integrity,
      unpackedBytes: report.artifact.unpackedBytes,
      directDependencyCount: report.artifact.directDependencyCount,
      nativeRiskCount: report.artifact.nativeRiskDependencies.length,
      shrinkwrapConsistent: shrinkwrap.compatible,
      shrinkwrapMissingCount: shrinkwrap.missingCount,
      shrinkwrapMismatchedCount: shrinkwrap.mismatchedCount
    },
    checks: countStatuses(report.checks),
    dependencyChangesFromStable: compareDirectDependencies(
      stableArtifact.directDependencies,
      report.artifact.directDependencies
    ),
    deltaFromStable: {
      unpackedBytes: report.artifact.unpackedBytes - stableArtifact.unpackedBytes,
      directDependencyCount: report.artifact.directDependencyCount - stableArtifact.directDependencyCount,
      nativeRiskCount: report.artifact.nativeRiskDependencies.length - stableArtifact.nativeRiskDependencies.length,
      shrinkwrapMissingCount: shrinkwrap.missingCount - stableArtifact.shrinkwrapRootConsistency.missingCount
    }
  };
}

export function buildReleaseHistory({ packageName, channels, reports, reportPaths, generatedAt }) {
  for (const channel of CHANNEL_ORDER) {
    if (!channels[channel] || !reports[channel] || !reportPaths[channel]) {
      throw new Error(`Release history is missing ${channel} data.`);
    }
    if (reports[channel].artifact.version !== channels[channel]) {
      throw new Error(`${channel} report version does not match its resolved channel.`);
    }
  }

  return {
    schemaVersion: 1,
    generatedAt,
    package: packageName,
    channels,
    releases: CHANNEL_ORDER.map((channel) => summarizeReport(
      channel,
      reports[channel],
      reportPaths[channel],
      reports.stable
    ))
  };
}
