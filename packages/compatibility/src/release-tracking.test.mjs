import assert from "node:assert/strict";
import test from "node:test";
import { buildReleaseHistory, resolveReleaseChannels } from "./release-tracking.mjs";

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

function report(version, { status = "probing", gateway = false, deps = 10, native = 2, missing = 3 } = {}) {
  return {
    generatedAt: "2026-07-12T00:00:00.000Z",
    status,
    artifact: {
      version,
      integrity: `sha512-${version}`,
      unpackedBytes: 1000 + deps,
      directDependencyCount: deps,
      nativeRiskDependencies: Array.from({ length: native }, (_, index) => ({ name: `native-${index}` })),
      shrinkwrapRootConsistency: {
        compatible: missing === 0,
        missingCount: missing,
        mismatchedCount: 0
      }
    },
    evidence: gateway ? [{ id: "gateway-health" }] : [],
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
      stable: report(channels.stable, { status: "partial", gateway: true, deps: 12, native: 3, missing: 2 }),
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
});
