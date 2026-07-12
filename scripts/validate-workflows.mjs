#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const workflowDirectory = resolve(root, ".github/workflows");
const workflowFiles = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .sort();

assert.ok(workflowFiles.length > 0, "at least one GitHub Actions workflow is required");

for (const name of workflowFiles) {
  const source = readFileSync(resolve(workflowDirectory, name), "utf8");
  const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
  for (const action of uses) {
    const separator = action.lastIndexOf("@");
    assert.ok(separator > 0, `${name}: action reference is missing @: ${action}`);
    const ref = action.slice(separator + 1);
    assert.match(ref, /^[a-f0-9]{40}$/, `${name}: action must be pinned to a full commit SHA: ${action}`);
  }
}

const compatibility = readFileSync(resolve(workflowDirectory, "compatibility.yml"), "utf8");
const npmPublish = readFileSync(resolve(workflowDirectory, "npm-publish.yml"), "utf8");
const pages = readFileSync(resolve(workflowDirectory, "pages.yml"), "utf8");
const runtimeBrowser = readFileSync(resolve(workflowDirectory, "runtime-browser.yml"), "utf8");
const sdkRelease = readFileSync(resolve(workflowDirectory, "sdk-release.yml"), "utf8");
const publishMarker = "\n  publish-report-pr:\n";
const publishIndex = compatibility.indexOf(publishMarker);
assert.ok(publishIndex > 0, "compatibility workflow must separate report generation from publishing");
const generationJob = compatibility.slice(0, publishIndex);
const publishJob = compatibility.slice(publishIndex);

assert.match(generationJob, /permissions:\n\s+contents: read/, "report generation must be read-only");
assert.doesNotMatch(generationJob, /contents: write|pull-requests: write/, "report generation must not have write permissions");
assert.match(generationJob, /npm ci/, "report generation must install the locked toolchain");
assert.match(generationJob, /npm run report-pin:generate/, "report generation must update the reviewed SDK host pin");
assert.match(generationJob, /npm run report-pin:check/, "report generation must verify the SDK host pin");
assert.match(generationJob, /npm run compat:validate/, "report generation must validate evidence before upload");
assert.match(generationJob, /examples\/sdk-host\/src\/report-pin\.ts/, "validated report artifacts must contain the SDK host pin");
assert.match(generationJob, /apps\/web\/public\/data\/promotion-policy\.json/, "validated report artifacts must contain the promotion policy");
assert.ok(
  generationJob.indexOf("Package validated reports") < generationJob.indexOf("actions/upload-artifact@"),
  "validated reports must be packaged before artifact upload"
);

assert.match(publishJob, /contents: write/, "report publishing requires contents write permission");
assert.match(publishJob, /pull-requests: write/, "report publishing requires pull-request write permission");
assert.doesNotMatch(publishJob, /npm ci|npm install|npm run/, "the write-capable publishing job must not execute npm code");
assert.match(publishJob, /Report artifact contains an unsafe path/, "report publishing must reject archive path traversal");
assert.match(publishJob, /Report artifact must not contain symlinks/, "report publishing must reject artifact symlinks");
assert.match(publishJob, /cp .*report-pin\.ts.*examples\/sdk-host\/src\/report-pin\.ts/, "report publishing must install the validated SDK host pin");
assert.match(publishJob, /git add .*examples\/sdk-host\/src\/report-pin\.ts/, "report publishing must commit the SDK host pin with reports");
assert.match(publishJob, /git add .*promotion-policy\.json/, "report publishing must commit the promotion policy with reports");

assert.match(runtimeBrowser, /capture_browserpod:[\s\S]*?type: boolean[\s\S]*?default: false/u, "BrowserPod capture must require explicit dispatch input");
assert.match(runtimeBrowser, /environment: browserpod-evidence/u, "BrowserPod capture must use the protected evidence environment");
assert.match(runtimeBrowser, /github\.event_name == 'workflow_dispatch'/u, "metered BrowserPod capture must be dispatch-only");
assert.match(runtimeBrowser, /npm ci --prefix examples\/browserpod-evidence-host --ignore-scripts/u, "BrowserPod capture must install its exact isolated lock without scripts");
assert.equal(runtimeBrowser.match(/secrets\.BROWSERPOD_API_KEY/gu)?.length, 1, "BrowserPod key must enter one capture step only");
assert.match(runtimeBrowser, /path: test-results\/browserpod-evidence/u, "BrowserPod capture must retain reviewed evidence artifacts");
assert.match(runtimeBrowser, /\n  pull_request:\n/u, "the required browser-host check must run for every pull request");
assert.doesNotMatch(runtimeBrowser, /pull_request:\n\s+paths:/u, "required browser-host checks must not be skipped by path filters");
assert.match(pages, /npm run build:pages/u, "Pages deployment must build all release-readiness artifacts");
assert.doesNotMatch(pages, /npm run build\n/u, "Pages deployment must not run the incomplete site-only build");

const sdkPublishMarker = "\n  publish:\n";
const sdkPublishIndex = sdkRelease.indexOf(sdkPublishMarker);
assert.ok(sdkPublishIndex > 0, "SDK release workflow must separate build from publishing");
const sdkBuildJob = sdkRelease.slice(0, sdkPublishIndex);
const sdkPublishJob = sdkRelease.slice(sdkPublishIndex);
assert.match(sdkRelease, /tags:\n\s+- "v\*\.\*\.\*-\*"/u, "SDK release must require an explicit prerelease tag");
assert.match(sdkBuildJob, /permissions:\n\s+contents: read/u, "SDK release build must remain read-only");
assert.doesNotMatch(sdkBuildJob, /contents: write/u, "SDK release build must not write repository contents");
assert.match(sdkBuildJob, /npm run release:check/u, "SDK release build must pass the full release gate");
assert.match(sdkBuildJob, /build-sdk-release-assets\.mjs/u, "SDK release build must generate bound assets");
assert.match(sdkPublishJob, /permissions:\n\s+contents: write/u, "SDK release publishing requires contents write permission");
assert.match(sdkPublishJob, /actions: write/u, "SDK release publishing requires workflow dispatch permission");
assert.doesNotMatch(sdkPublishJob, /npm ci|npm install|npm run|npx /u, "write-capable SDK publishing must not execute npm code");
assert.match(sdkPublishJob, /Release artifact contains an unsafe path/u, "SDK publishing must reject archive path traversal");
assert.match(sdkPublishJob, /Release artifact must not contain symlinks/u, "SDK publishing must reject artifact symlinks");
assert.match(sdkPublishJob, /gh release create/u, "SDK publishing must create a GitHub release");
assert.match(sdkPublishJob, /gh workflow run npm-publish\.yml/u, "SDK publishing must dispatch npm publication explicitly");
assert.match(sdkPublishJob, /--verify-tag/u, "SDK publishing must bind the release to the pushed tag");
assert.match(sdkPublishJob, /--prerelease/u, "SDK publishing must never mark the source alpha stable");
assert.doesNotMatch(sdkPublishJob, /--latest/u, "SDK publishing must not promote the source alpha as latest");

assert.match(npmPublish, /release:\n\s+types: \[published\]/u, "npm publishing must follow a published GitHub Release");
assert.match(npmPublish, /workflow_dispatch:/u, "npm publishing must support an explicit bootstrap dispatch");
assert.doesNotMatch(npmPublish, /pull_request:/u, "npm publishing must never run for pull requests");
assert.match(npmPublish, /permissions:\n\s+contents: read\n\s+id-token: write/u, "npm publishing must use read-only source plus OIDC");
assert.doesNotMatch(npmPublish, /contents: write/u, "npm publishing must not write repository contents");
assert.match(npmPublish, /environment: npm-publish/u, "npm publishing must use its deployment environment");
assert.match(npmPublish, /npm@12\.0\.1/u, "npm publishing must pin a trusted-publishing-capable CLI");
assert.match(npmPublish, /npm run release:check/u, "npm publishing must repeat the full release gate");
assert.ok(
  npmPublish.indexOf("npm run release:check") < npmPublish.indexOf("npm@12.0.1"),
  "npm publishing must validate the tag with its locked toolchain before upgrading the publish-only CLI"
);
assert.match(npmPublish, /gh release download/u, "npm publishing must fetch the reviewed GitHub Release assets");
assert.match(npmPublish, /cmp "\$tarball" "\$release_dir\/haya-inc-clawsembly-\$version\.tgz"/u, "npm publishing must compare the built and GitHub Release tarballs");
assert.match(npmPublish, /npm publish .*--access public --tag alpha --provenance/u, "npm publishing must remain a provenance-backed alpha");
assert.equal(npmPublish.match(/secrets\.NPM_TOKEN/gu)?.length, 1, "the bootstrap npm token must enter one publish step only");

process.stdout.write(`Validated ${workflowFiles.length} pinned workflows and compatibility-job permissions.\n`);
