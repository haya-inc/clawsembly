import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildSdkReleaseManifest } from "./sdk-release.mjs";

const schema = JSON.parse(readFileSync(new URL("../sdk-release.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const sha256 = "a".repeat(64);
const integrity = `sha512-${"a".repeat(86)}==`;

function input() {
  return {
    sdk: { name: "@haya-inc/clawsembly", version: "0.1.0-alpha.0", private: false },
    tarball: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz", bytes: 123, sha256, integrity },
    checksum: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz.sha256", bytes: 100, value: sha256 },
    reportSha256: "b".repeat(64),
    publication: {
      schemaVersion: 1,
      package: { name: "@haya-inc/clawsembly", version: "0.1.0-alpha.0" },
      registry: "https://registry.npmjs.org/",
      distTag: "alpha",
      status: "pending"
    },
    report: {
      schemaVersion: 1,
      status: "probing",
      target: { runtime: "browserpod", runtimeVersion: "2.12.1" },
      artifact: { package: "openclaw", version: "2026.6.11", integrity: "sha512-report" }
    }
  };
}

test("builds a schema-valid Pages SDK release without claiming npm publication", () => {
  const release = buildSdkReleaseManifest(input());
  assert.equal(release.distribution.npmPublished, false);
  assert.equal(release.compatibility.status, "probing");
  assert.equal(
    release.install.command,
    "npm install https://haya-inc.github.io/clawsembly/downloads/haya-inc-clawsembly-0.1.0-alpha.0.tgz"
  );
  assert.equal(validate(release), true, JSON.stringify(validate.errors));
});

test("builds a registry install record only from exact published npm evidence", () => {
  const published = input();
  published.publication = {
    ...published.publication,
    status: "published",
    integrity,
    publishedAt: "2026-07-12T09:24:36.000Z",
    provenanceUrl: "https://search.sigstore.dev/?logIndex=2149887461"
  };
  const release = buildSdkReleaseManifest(published);
  assert.equal(release.distribution.npmPublished, true);
  assert.equal(release.distribution.npm.integrity, integrity);
  assert.equal(release.install.command, "npm install @haya-inc/clawsembly@0.1.0-alpha.0");
  assert.equal(validate(release), true, JSON.stringify(validate.errors));
});

test("rejects file-name, checksum, and compatibility identity drift", () => {
  const wrongFile = input();
  wrongFile.tarball.file = "other.tgz";
  assert.throws(() => buildSdkReleaseManifest(wrongFile), /tarball release record/u);
  const wrongChecksum = input();
  wrongChecksum.checksum.value = "c".repeat(64);
  assert.throws(() => buildSdkReleaseManifest(wrongChecksum), /checksum release record/u);
  const wrongRuntime = input();
  wrongRuntime.report.target.runtime = "remote";
  assert.throws(() => buildSdkReleaseManifest(wrongRuntime), /compatibility binding/u);
  const wrongPublication = input();
  wrongPublication.publication.package.version = "0.1.0-alpha.1";
  assert.throws(() => buildSdkReleaseManifest(wrongPublication), /npm publication record/u);
  const wrongIntegrity = input();
  wrongIntegrity.publication = {
    ...wrongIntegrity.publication,
    status: "published",
    integrity: `sha512-${"b".repeat(86)}==`,
    publishedAt: "2026-07-12T09:24:36.000Z",
    provenanceUrl: "https://search.sigstore.dev/?logIndex=2149887461"
  };
  assert.throws(() => buildSdkReleaseManifest(wrongIntegrity), /not bound/u);
});
