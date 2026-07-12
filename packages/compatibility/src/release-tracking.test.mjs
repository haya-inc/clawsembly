import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseHistory, compareDirectDependencies, resolveReleaseChannels } from "./release-tracking.mjs";

test("resolveReleaseChannels follows latest, previous stable, and beta", () => {
  assert.deepEqual(resolveReleaseChannels({
    latest: "2026.6.11",
    beta: "2026.7.1-beta.5"
  }, [
    "2026.6.9",
    "2026.6.10-beta.1",
    "2026.6.10",
    "2026.6.11-beta.1",
    "2026.6.11",
    "2026.7.1-beta.5"
  ]), {
    stable: "2026.6.11",
    previous: "2026.6.10",
    preview: "2026.7.1-beta.5"
  });
});

test("resolveReleaseChannels rejects a stale latest tag", () => {
  assert.throws(
    () => resolveReleaseChannels({ latest: "2026.6.12" }, ["2026.6.11"]),
    /does not resolve/
  );
});

function report(version, { status = "probing", runtimeEvidence = false, deps = 10, native = 2, missing = 3 } = {}) {
  const directDependencies = Array.from({ length: deps }, (_, index) => ({ name: `dep-${index}`, spec: "1.0.0" }));
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    status,
    artifact: {
      version,
      integrity: `sha512-${version}`,
      unpackedBytes: 1000 + deps,
      directDependencyCount: deps,
      directDependencies,
      nativeRiskDependencies: Array.from({ length: native }, (_, index) => ({ name: `native-${index}` })),
      shrinkwrapRootConsistency: {
        compatible: missing === 0,
        missingCount: missing,
        mismatchedCount: 0
      }
    },
    evidence: runtimeEvidence ? [{ id: "browserpod-runtime" }] : [],
    checks: [
      { status: "pass" },
      { status: missing ? "warn" : "pass" },
      { status: "pending" }
    ]
  };
}

test("buildReleaseHistory preserves evidence levels and stable deltas", () => {
  const channels = {
    stable: "2026.6.11",
    previous: "2026.6.10",
    preview: "2026.7.1-beta.5"
  };
  const history = buildReleaseHistory({
    packageName: "openclaw",
    channels,
    reports: {
      stable: report(channels.stable, { status: "partial", runtimeEvidence: true, deps: 12, native: 3, missing: 2 }),
      previous: report(channels.previous, { deps: 10, native: 2, missing: 0 }),
      preview: report(channels.preview, { deps: 14, native: 4, missing: 5 })
    },
    reportPaths: {
      stable: "releases/openclaw-2026.6.11.json",
      previous: "releases/openclaw-2026.6.10.json",
      preview: "releases/openclaw-2026.7.1-beta.5.json"
    },
    generatedAt: "2026-07-12T00:00:00.000Z"
  });

  assert.equal(history.releases[0].runtimeEvidence, true);
  assert.equal(history.releases[1].runtimeEvidence, false);
  assert.deepEqual(history.releases[1].deltaFromStable, {
    unpackedBytes: -2,
    directDependencyCount: -2,
    nativeRiskCount: -1,
    shrinkwrapMissingCount: -2
  });
  assert.deepEqual(history.releases[2].checks, { pass: 1, warn: 1, fail: 0, pending: 1 });
  assert.deepEqual(history.releases[0].dependencyChangesFromStable, { added: [], removed: [], changed: [] });
  assert.deepEqual(history.releases[1].dependencyChangesFromStable.removed.map(({ name }) => name), ["dep-10", "dep-11"]);
  assert.deepEqual(history.releases[2].dependencyChangesFromStable.added.map(({ name }) => name), ["dep-12", "dep-13"]);
});

test("compareDirectDependencies reports exact added, removed, and changed specs", () => {
  assert.deepEqual(compareDirectDependencies([
    { name: "changed", spec: "1.0.0" },
    { name: "removed", spec: "2.0.0" },
    { name: "same", spec: "3.0.0" }
  ], [
    { name: "added", spec: "4.0.0" },
    { name: "changed", spec: "1.1.0" },
    { name: "same", spec: "3.0.0" }
  ]), {
    added: [{ name: "added", spec: "4.0.0" }],
    removed: [{ name: "removed", spec: "2.0.0" }],
    changed: [{ name: "changed", stableSpec: "1.0.0", releaseSpec: "1.1.0" }]
  });
});
