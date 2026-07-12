#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildSdkReleaseManifest } from "../packages/compatibility/src/sdk-release.mjs";

const root = process.cwd();
const sdk = JSON.parse(await readFile(resolve(root, "packages/sdk-package/package.json"), "utf8"));
const fileName = `haya-inc-clawsembly-${sdk.version}.tgz`;
const artifactDirectory = resolve(root, ".artifacts/sdk");
const tarballPath = resolve(artifactDirectory, fileName);
const checksumPath = resolve(artifactDirectory, `${fileName}.sha256`);
const tarball = await readFile(tarballPath);
const checksum = await readFile(checksumPath, "utf8");
const sha256 = createHash("sha256").update(tarball).digest("hex");
if (checksum !== `${sha256}  ${fileName}\n`) throw new Error("SDK checksum file does not match the tarball bytes.");

const reportSource = await readFile(resolve(root, "apps/web/public/data/compatibility.json"), "utf8");
const report = JSON.parse(reportSource);
const reportSha256 = createHash("sha256").update(reportSource).digest("hex");
const checksumStats = await stat(checksumPath);
const release = buildSdkReleaseManifest({
  sdk,
  tarball: { file: basename(tarballPath), bytes: tarball.byteLength, sha256 },
  checksum: { file: basename(checksumPath), bytes: checksumStats.size, value: sha256 },
  report,
  reportSha256
});

const destination = resolve(root, "dist/downloads");
await mkdir(destination, { recursive: true });
await copyFile(tarballPath, resolve(destination, fileName));
await copyFile(checksumPath, resolve(destination, `${fileName}.sha256`));
await writeFile(resolve(destination, "sdk-release.json"), `${JSON.stringify(release, null, 2)}\n`);
process.stdout.write(`Published ${fileName} (${sha256}) to dist/downloads.\n`);
