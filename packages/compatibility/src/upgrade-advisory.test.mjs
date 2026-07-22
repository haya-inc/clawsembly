import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { assertUpgradeAdvisory, buildUpgradeAdvisory } from "./upgrade-advisory.mjs";

const dataDirectory = resolve(import.meta.dirname, "../../../apps/web/public/data");
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function committedInputs() {
  const history = readJson(resolve(dataDirectory, "release-history.json"));
  const promotionPolicy = readJson(resolve(dataDirectory, "promotion-policy.json"));
  const reportsByPath = new Map(history.releases.map((release) => [
    release.reportPath,
    readJson(resolve(dataDirectory, release.reportPath))
  ]));
  return { history, promotionPolicy, reportsByPath };
}

test("the committed advisory derives exactly from the committed inputs", () => {
  const { history, promotionPolicy, reportsByPath } = committedInputs();
  const advisory = buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath });
  assert.equal(assertUpgradeAdvisory(advisory), advisory);
  assert.deepEqual(readJson(resolve(dataDirectory, "upgrade-advisory.json")), advisory);
  assert.equal(advisory.generatedAt, history.generatedAt);
  assert.deepEqual(advisory.advisories.map((entry) => entry.path), ["previous->stable", "stable->preview"]);
});

test("a promotion hold pins the preview-adoption verdict to hold", () => {
  const { history, promotionPolicy, reportsByPath } = committedInputs();
  assert.equal(promotionPolicy.decision, "hold");
  const advisory = buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath });
  const preview = advisory.advisories.find((entry) => entry.path === "stable->preview");
  assert.equal(preview.verdict, "hold");
  assert.ok(preview.reasons.includes("promotion-policy-holds"));
  // The tracked preview removes the skills surface; the advisory must carry
  // that as a bounded breaking-surface signal, never silently.
  assert.equal(preview.surface.classification, "breaking");
  assert.ok(preview.surface.coreMethods.removed.count > 0);
  assert.ok(preview.surface.coreMethods.removed.sample.length <= 16);
});

test("the previous-to-stable path reads the tracker diff in reverse", () => {
  const { history, promotionPolicy, reportsByPath } = committedInputs();
  const advisory = buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath });
  const toStable = advisory.advisories.find((entry) => entry.path === "previous->stable");
  const previousEntry = history.releases.find((release) => release.channel === "previous");
  const diff = previousEntry.gatewayContractFromStable.coreMethods;
  // What stable adds over previous is what the previous entry records as
  // "removed" relative to stable.
  assert.equal(toStable.surface.coreMethods.added.count, (diff.removed ?? []).length);
  assert.equal(toStable.surface.coreMethods.removed.count, (diff.added ?? []).length);
});

test("advisory validation fails closed on shape drift", () => {
  const { history, promotionPolicy, reportsByPath } = committedInputs();
  const advisory = buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath });
  assert.throws(() => assertUpgradeAdvisory({ ...advisory, advisories: [] }));
  assert.throws(() => assertUpgradeAdvisory({
    ...advisory,
    advisories: [advisory.advisories[0], { ...advisory.advisories[1], verdict: "ship-it" }]
  }));
  assert.throws(() => buildUpgradeAdvisory(history, { promotionPolicy: {}, reportsByPath }));
  assert.throws(() => buildUpgradeAdvisory(history, { promotionPolicy, reportsByPath: new Map() }));
});
