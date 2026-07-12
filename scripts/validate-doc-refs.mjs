#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const sdkManifest = JSON.parse(readFileSync(resolve(root, "packages/sdk-package/package.json"), "utf8"));
const releaseTag = `v${sdkManifest.version}`;
const documentExtensions = [".md", ".yml", ".yaml", ".example"];
const skippedDirectories = new Set([".git", ".claude", "node_modules", "dist", "test-results", "playwright-report"]);

// Copy-paste references such as `uses: haya-inc/clawsembly/<path>@<ref>`.
const usesReferencePattern = /\bhaya-inc\/clawsembly\/([A-Za-z0-9._/-]+)@([A-Za-z0-9._/-]+)/g;
// Repository URLs that embed a git ref before an in-repo path.
const urlReferencePattern =
  /(?:github\.com\/haya-inc\/clawsembly\/(?:blob|tree|raw)|raw\.githubusercontent\.com\/haya-inc\/clawsembly)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._/-]+)/g;

function collectDocumentFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) files.push(...collectDocumentFiles(path));
    } else if (documentExtensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(path);
    }
  }
  return files;
}

function assertKnownRef(file, reference, ref) {
  assert.ok(
    ref === "main" || ref === releaseTag || /^[a-f0-9]{40}$/.test(ref),
    `${file}: ${reference} must reference main, ${releaseTag}, or a full commit SHA, not ${ref}`
  );
}

function assertRepositoryPath(file, reference, path) {
  assert.ok(!path.split("/").includes(".."), `${file}: ${reference} must not traverse outside the repository`);
  const absolute = resolve(root, path);
  assert.ok(existsSync(absolute), `${file}: ${reference} points at ${path}, which does not exist in this repository`);
  if (statSync(absolute).isDirectory() && reference.includes("@")) {
    assert.ok(
      existsSync(join(absolute, "action.yml")) || existsSync(join(absolute, "action.yaml")),
      `${file}: ${reference} points at ${path}, which has no action.yml to run`
    );
  }
}

let usesReferences = 0;
let urlReferences = 0;
const documentFiles = collectDocumentFiles(root);
for (const path of documentFiles) {
  const file = relative(root, path).replaceAll("\\", "/");
  const source = readFileSync(path, "utf8");
  for (const [reference, target, ref] of source.matchAll(usesReferencePattern)) {
    usesReferences += 1;
    assertKnownRef(file, reference, ref);
    assertRepositoryPath(file, reference, target);
  }
  for (const [reference, ref, target] of source.matchAll(urlReferencePattern)) {
    urlReferences += 1;
    assertKnownRef(file, reference, ref);
    if (ref === "main") assertRepositoryPath(file, reference, target);
  }
}

assert.ok(usesReferences > 0, "the documented promotion-policy Action reference was not found");

process.stdout.write(
  `Validated ${usesReferences + urlReferences} repository references across ${documentFiles.length} documentation files.\n`
);
