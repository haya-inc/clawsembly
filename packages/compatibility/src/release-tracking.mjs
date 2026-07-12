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

function inventoryDelta(stable = [], release = []) {
  const stableSet = new Set(stable);
  const releaseSet = new Set(release);
  return {
    added: [...releaseSet].filter((value) => !stableSet.has(value)).sort((left, right) => left.localeCompare(right)),
    removed: [...stableSet].filter((value) => !releaseSet.has(value)).sort((left, right) => left.localeCompare(right))
  };
}

function sourceChanged(stable, release, key) {
  return stable?.sources?.[key]?.sha256 !== release?.sources?.[key]?.sha256;
}

export function compareGatewayContracts(stable, release) {
  if (!stable?.inspection || !release?.inspection || !stable?.protocol || !release?.protocol) {
    throw new Error("Gateway contract comparison requires inspected artifacts.");
  }
  const coreMethods = inventoryDelta(stable.inventories?.coreMethods, release.inventories?.coreMethods);
  const schemaExports = inventoryDelta(stable.inventories?.schemaExports, release.inventories?.schemaExports);
  const validators = inventoryDelta(stable.inventories?.validators, release.inventories?.validators);
  const eventSchemas = inventoryDelta(stable.inventories?.eventSchemas, release.inventories?.eventSchemas);
  const protocol = {
    stable: stable.protocol,
    release: release.protocol,
    changed: JSON.stringify(stable.protocol) !== JSON.stringify(release.protocol)
  };
  const distribution = {
    legacyPluginDeclarationCount: {
      stable: stable.distribution?.legacyPluginDeclarationCount ?? 0,
      release: release.distribution?.legacyPluginDeclarationCount ?? 0,
      delta: (release.distribution?.legacyPluginDeclarationCount ?? 0)
        - (stable.distribution?.legacyPluginDeclarationCount ?? 0)
    },
    publicDeclarationChanged: sourceChanged(stable, release, "publicDeclaration"),
    publicRuntimeChanged: sourceChanged(stable, release, "publicRuntime"),
    versionModuleChanged: sourceChanged(stable, release, "versionModule"),
    serverMethodsChanged: sourceChanged(stable, release, "serverMethods")
  };
  const inventoryRemoved = [coreMethods, schemaExports, validators, eventSchemas]
    .some((delta) => delta.removed.length > 0);
  const minimumNarrowed = ["minClient", "minProbe", "minNode"].some((key) => {
    const before = stable.protocol[key];
    const after = release.protocol[key];
    return before !== null && (after === null || after > before);
  });
  const protocolBreaking = stable.protocol.current !== release.protocol.current || minimumNarrowed;
  const legacyDeclarationsRemoved = distribution.legacyPluginDeclarationCount.delta < 0;
  const hasAdditions = [coreMethods, schemaExports, validators, eventSchemas]
    .some((delta) => delta.added.length > 0);
  const anySourceChanged = distribution.publicDeclarationChanged || distribution.publicRuntimeChanged
    || distribution.versionModuleChanged || distribution.serverMethodsChanged;
  let classification = "unchanged";
  if (stable.inspection.status !== "complete" || release.inspection.status !== "complete") classification = "incomplete";
  else if (protocolBreaking || inventoryRemoved || legacyDeclarationsRemoved) classification = "breaking";
  else if (protocol.changed || hasAdditions || distribution.legacyPluginDeclarationCount.delta > 0) classification = "additive";
  else if (anySourceChanged) classification = "changed";
  return {
    classification,
    inspection: { stable: stable.inspection.status, release: release.inspection.status },
    protocol,
    distribution,
    coreMethods,
    schemaExports,
    validators,
    eventSchemas
  };
}

function validateDependencyRisks(channel, report, changes, risks = []) {
  const expected = new Map([
    ...changes.added.map(({ name }) => [name, "added"]),
    ...changes.changed.map(({ name }) => [name, "changed"])
  ]);
  if (!Array.isArray(risks) || risks.length !== expected.size) {
    throw new Error(`${channel} dependency risk inventory is incomplete.`);
  }
  const dependencies = new Map(report.artifact.directDependencies.map((dependency) => [dependency.name, dependency]));
  const seen = new Set();
  for (const risk of risks) {
    const dependency = dependencies.get(risk?.name);
    if (!dependency || seen.has(risk.name) || expected.get(risk.name) !== risk.change
      || risk.declaredSpec !== dependency.spec || risk.resolvedVersion !== dependency.resolvedVersion
      || risk.integrity !== dependency.integrity) {
      throw new Error(`${channel} dependency risk identity drift: ${risk?.name ?? "unknown"}.`);
    }
    seen.add(risk.name);
  }
  return [...risks].sort((left, right) => left.name.localeCompare(right.name));
}

function summarizeReport(channel, report, reportPath, stableReport, dependencyRisks) {
  const shrinkwrap = report.artifact.shrinkwrapRootConsistency;
  const stableArtifact = stableReport.artifact;
  const dependencyChangesFromStable = compareDirectDependencies(
    stableArtifact.directDependencies,
    report.artifact.directDependencies
  );
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
    dependencyChangesFromStable,
    dependencyRiskFromStable: validateDependencyRisks(
      channel,
      report,
      dependencyChangesFromStable,
      dependencyRisks
    ),
    gatewayContractFromStable: compareGatewayContracts(
      stableArtifact.gatewayContract,
      report.artifact.gatewayContract
    ),
    deltaFromStable: {
      unpackedBytes: report.artifact.unpackedBytes - stableArtifact.unpackedBytes,
      directDependencyCount: report.artifact.directDependencyCount - stableArtifact.directDependencyCount,
      nativeRiskCount: report.artifact.nativeRiskDependencies.length - stableArtifact.nativeRiskDependencies.length,
      shrinkwrapMissingCount: shrinkwrap.missingCount - stableArtifact.shrinkwrapRootConsistency.missingCount
    }
  };
}

export function buildReleaseHistory({ packageName, channels, reports, reportPaths, dependencyRisks = {}, generatedAt }) {
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
      reports.stable,
      dependencyRisks[channel] ?? []
    ))
  };
}
