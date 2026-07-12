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

function input() {
  return {
    sdk: { name: "@haya-inc/clawsembly", version: "0.1.0-alpha.0", private: false },
    tarball: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz", bytes: 123, sha256 },
    checksum: { file: "haya-inc-clawsembly-0.1.0-alpha.0.tgz.sha256", bytes: 100, value: sha256 },
    reportSha256: "b".repeat(64),
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
});
