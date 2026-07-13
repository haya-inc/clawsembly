import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assertCompatibilityReportBinding,
  assertSdkReleaseBinding,
  localMarkdownTargets
} from "./release-binding.mjs";

const VERSION = "0.1.0-alpha.9";
const TARBALL = Buffer.from("clawsembly-release-binding-fixture");
const SHA256 = createHash("sha256").update(TARBALL).digest("hex");
const INTEGRITY = `sha512-${createHash("sha512").update(TARBALL).digest("base64")}`;
const PAGES_URL = `https://haya-inc.github.io/clawsembly/downloads/haya-inc-clawsembly-${VERSION}.tgz`;

function sdkRelease({ published = true, mutate } = {}) {
  const release = {
    schemaVersion: 1,
    package: { name: "@haya-inc/clawsembly", version: VERSION },
    distribution: {
      npmPublished: published,
      tarball: {
        file: `haya-inc-clawsembly-${VERSION}.tgz`,
        url: PAGES_URL,
        sha256: SHA256,
        bytes: TARBALL.byteLength
      },
      checksum: {
        file: `haya-inc-clawsembly-${VERSION}.tgz.sha256`,
        value: SHA256
      },
      ...(published ? { npm: { integrity: INTEGRITY } } : {})
    },
    install: {
      command: published
        ? `npm install @haya-inc/clawsembly@${VERSION}`
        : `npm install ${PAGES_URL}`
    },
    compatibility: {
      status: "probing",
      reportSha256: "set-by-report-tests",
      openclaw: { version: "2026.6.11", integrity: "sha512-openclaw" },
      runtime: { provider: "browserpod", version: "2.12.1" }
    }
  };
  mutate?.(release);
  return release;
}

function publication({ published = true } = {}) {
  return published
    ? { status: "published", integrity: INTEGRITY }
    : { status: "pending" };
}

function bind(overrides = {}) {
  return assertSdkReleaseBinding({
    sdkRelease: sdkRelease(overrides),
    npmPublication: publication(overrides),
    sdkTarballBytes: TARBALL,
    sdkPackageVersion: VERSION,
    checksumFileText: `${SHA256}  haya-inc-clawsembly-${VERSION}.tgz\n`,
    ...overrides.inputs
  });
}

test("binds a published release to matching bytes, record, and checksum", () => {
  const bound = bind();
  assert.equal(bound.sha256, SHA256);
  assert.equal(bound.integrity, INTEGRITY);
  assert.equal(bound.tarballFile, `haya-inc-clawsembly-${VERSION}.tgz`);
});

test("accepts a pending release only on the verified Pages install path", () => {
  assert.equal(bind({ published: false }).integrity, INTEGRITY);
  assert.throws(
    () => bind({ published: false, mutate: (release) => { release.distribution.npm = { integrity: INTEGRITY }; } }),
    /pending npm record/u
  );
  assert.throws(
    () => bind({
      published: false,
      mutate: (release) => { release.install.command = `npm install @haya-inc/clawsembly@${VERSION}`; }
    }),
    /pending npm record/u
  );
});

test("rejects a publication record whose integrity is not the deployed bytes", () => {
  assert.throws(
    () => assertSdkReleaseBinding({
      sdkRelease: sdkRelease(),
      npmPublication: { status: "published", integrity: "sha512-someone-elses-bytes" },
      sdkTarballBytes: TARBALL,
      sdkPackageVersion: VERSION,
      checksumFileText: `${SHA256}  haya-inc-clawsembly-${VERSION}.tgz\n`
    }),
    /publication record integrity/u
  );
});

test("rejects identity, byte, and checksum drift", () => {
  assert.throws(
    () => assertSdkReleaseBinding({
      sdkRelease: sdkRelease(),
      npmPublication: publication(),
      sdkTarballBytes: TARBALL,
      sdkPackageVersion: "0.1.0-alpha.8",
      checksumFileText: "unused"
    }),
    /misidentifies/u
  );
  assert.throws(
    () => assertSdkReleaseBinding({
      sdkRelease: sdkRelease(),
      npmPublication: publication(),
      sdkTarballBytes: Buffer.concat([TARBALL, Buffer.from("!")]),
      sdkPackageVersion: VERSION,
      checksumFileText: "unused"
    }),
    /bytes do not match/u
  );
  assert.throws(
    () => bind({ inputs: { checksumFileText: `${"0".repeat(64)}  haya-inc-clawsembly-${VERSION}.tgz\n` } }),
    /checksum does not match/u
  );
  assert.throws(
    () => bind({ mutate: (release) => { release.distribution.npmPublished = false; } }),
    /misidentifies/u
  );
});

test("binds the compatibility identity to the deployed report bytes", () => {
  const report = {
    status: "probing",
    artifact: { version: "2026.6.11", integrity: "sha512-openclaw" },
    target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
  };
  const publicReportText = JSON.stringify(report);
  const release = sdkRelease({
    mutate: (value) => {
      value.compatibility.reportSha256 = createHash("sha256").update(publicReportText).digest("hex");
    }
  });
  assert.equal(
    assertCompatibilityReportBinding({ sdkRelease: release, publicReportText }).reportSha256,
    release.compatibility.reportSha256
  );
  assert.throws(
    () => assertCompatibilityReportBinding({
      sdkRelease: release,
      publicReportText: JSON.stringify({ ...report, status: "supported" })
    }),
    /not bound to the deployed compatibility report/u
  );
  const drifted = JSON.stringify({ ...report, status: "supported" });
  assert.throws(
    () => assertCompatibilityReportBinding({
      sdkRelease: sdkRelease({
        mutate: (value) => {
          value.compatibility.reportSha256 = createHash("sha256").update(drifted).digest("hex");
        }
      }),
      publicReportText: drifted
    }),
    /compatibility identity drifted/u
  );
});

test("extracts only local markdown targets", () => {
  const targets = localMarkdownTargets([
    "[relative](docs/architecture.md)",
    "![image](apps/web/public/mark.svg)",
    "[anchor](#section)",
    "[external](https://example.com/page)",
    "[mail](mailto:someone@example.com)",
    "[titled](docs/roadmap.md \"Roadmap\")",
    "[wrapped](<docs/spaced file.md>)",
    "[encoded](docs/spaced%20file.md#part)"
  ].join("\n"));
  assert.deepEqual(targets, [
    "docs/architecture.md",
    "apps/web/public/mark.svg",
    "docs/roadmap.md",
    "docs/spaced file.md",
    "docs/spaced file.md"
  ]);
});
