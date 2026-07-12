#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildSourceReleaseProvenance, renderSourceReleaseNotes } from "../packages/compatibility/src/source-release.mjs";

const root = process.cwd();
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const tag = args.get("--tag");
const sourceCommit = args.get("--source");
const output = resolve(root, args.get("--output") ?? ".artifacts/github-release");
if (!tag || !sourceCommit) {
  throw new Error("Usage: build-sdk-release-assets.mjs --tag <tag> --source <40-hex-commit> [--output <path>]");
}

const sdkReleaseBytes = await readFile(resolve(root, "dist/downloads/sdk-release.json"));
const sdkRelease = JSON.parse(sdkReleaseBytes);
const tarballName = sdkRelease.distribution.tarball.file;
const checksumName = sdkRelease.distribution.checksum.file;
const tarball = await readFile(resolve(root, "dist/downloads", tarballName));
const checksum = await readFile(resolve(root, "dist/downloads", checksumName), "utf8");
const sha256 = createHash("sha256").update(tarball).digest("hex");
if (sha256 !== sdkRelease.distribution.tarball.sha256
  || checksum !== `${sha256}  ${tarballName}\n`) {
  throw new Error("Release asset bytes drifted from the Pages SDK manifest.");
}

const provenance = buildSourceReleaseProvenance({
  tag,
  sourceCommit,
  sdkRelease,
  pagesManifestSha256: createHash("sha256").update(sdkReleaseBytes).digest("hex")
});
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const copies = [
  [resolve(root, "dist/downloads", tarballName), tarballName],
  [resolve(root, "dist/downloads", checksumName), checksumName],
  [resolve(root, "dist/downloads/sdk-release.json"), "sdk-release.json"],
  [resolve(root, "apps/web/public/data/compatibility.json"), "compatibility.json"],
  [resolve(root, "apps/web/public/data/release-history.json"), "release-history.json"],
  [resolve(root, "apps/web/public/data/promotion-policy.json"), "promotion-policy.json"],
  [resolve(root, "packages/compatibility/source-release.schema.json"), "source-release.schema.json"]
];
for (const [source, destination] of copies) await cp(source, resolve(output, destination));
await writeFile(resolve(output, "source-release.json"), `${JSON.stringify(provenance, null, 2)}\n`);
await writeFile(resolve(output, "release-notes.md"), renderSourceReleaseNotes(provenance));
process.stdout.write(`Built ${basename(output)} for ${tag} at ${sourceCommit} (${sha256}).\n`);
