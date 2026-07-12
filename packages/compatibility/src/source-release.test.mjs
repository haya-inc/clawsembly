import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildSourceReleaseProvenance, renderSourceReleaseNotes } from "./source-release.mjs";

const schema = JSON.parse(readFileSync(new URL("../source-release.schema.json", import.meta.url), "utf8"));
const validate = new Ajv2020({ strict: true }).compile(schema);
const sha = "a".repeat(64);
const sourceCommit = "b".repeat(40);
const sdkRelease = {
  schemaVersion: 1,
  package: { name: "@haya-inc/clawsembly", version: "0.1.0-alpha.0" },
  distribution: {
    channel: "github-pages",
    npmPublished: false,
    tarball: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz", bytes: 12, sha256: sha },
    checksum: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz.sha256", value: sha }
  },
  compatibility: {
    status: "probing",
    reportUrl: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
    reportSha256: sha,
    openclaw: { version: "2026.6.11", integrity: "sha512-test" },
    runtime: { provider: "browserpod", version: "2.12.1" }
  }
};

test("builds schema-valid source release provenance and fail-closed notes", () => {
  const provenance = buildSourceReleaseProvenance({
    tag: "v0.1.0-alpha.0",
    sourceCommit,
    sdkRelease,
    pagesManifestSha256: sha
  });
  assert.equal(validate(provenance), true, JSON.stringify(validate.errors));
  const notes = renderSourceReleaseNotes(provenance);
  assert.match(notes, /does \*\*not\*\* claim verified BrowserPod runtime support/u);
  assert.match(notes, /Compatibility: `probing`/u);
  assert.match(notes, new RegExp(sourceCommit, "u"));
  assert.match(notes, /releases\/download\/v0\.1\.0-alpha\.0/u);
});

test("rejects tag, commit, checksum, and provider drift", () => {
  assert.throws(() => buildSourceReleaseProvenance({
    tag: "v0.1.0-alpha.1", sourceCommit, sdkRelease, pagesManifestSha256: sha
  }), /provenance is invalid/u);
  assert.throws(() => buildSourceReleaseProvenance({
    tag: "v0.1.0-alpha.0", sourceCommit: "main", sdkRelease, pagesManifestSha256: sha
  }), /provenance is invalid/u);
  assert.throws(() => buildSourceReleaseProvenance({
    tag: "v0.1.0-alpha.0",
    sourceCommit,
    sdkRelease: {
      ...sdkRelease,
      distribution: {
        ...sdkRelease.distribution,
        checksum: { ...sdkRelease.distribution.checksum, value: "c".repeat(64) }
      }
    },
    pagesManifestSha256: sha
  }), /provenance is invalid/u);
  assert.throws(() => buildSourceReleaseProvenance({
    tag: "v0.1.0-alpha.0",
    sourceCommit,
    sdkRelease: {
      ...sdkRelease,
      compatibility: {
        ...sdkRelease.compatibility,
        runtime: { provider: "other", version: "1" }
      }
    },
    pagesManifestSha256: sha
  }), /provenance is invalid/u);
});
