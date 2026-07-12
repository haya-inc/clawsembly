# Consuming compatibility reports

Clawsembly publishes small, static artifacts so downstream projects can display
or enforce OpenClaw browser compatibility without running the long browser probe.

## Human-facing badge

Embed the current stable result:

```markdown
[![OpenClaw browser compatibility](https://haya-inc.github.io/clawsembly/data/compatibility-badge.svg)](https://haya-inc.github.io/clawsembly/#compatibility)
```

The badge is generated from the same stable report used by the project page. A
`partial` badge means some runtime behavior is proven but the release has not
passed every production gate. It must not be interpreted as fully supported.

## Machine-readable endpoints

| Artifact | Stable URL | Purpose |
| --- | --- | --- |
| Current stable report | `https://haya-inc.github.io/clawsembly/data/compatibility.json` | Complete checks and evidence for npm `latest` |
| Release index | `https://haya-inc.github.io/clawsembly/data/release-history.json` | Stable, previous, and preview summaries with report paths |
| Report schema | repository `packages/compatibility/report.schema.json` | Validation contract for a complete report |
| History schema | repository `packages/compatibility/release-history.schema.json` | Validation contract for the channel index |
| BrowserPod evidence schema | repository `packages/compatibility/browserpod-evidence.schema.json` | Raw exact-artifact BrowserPod readiness contract |

Consumers should:

1. require the expected `schemaVersion`;
2. compare `artifact.version` and integrity with the artifact they will use;
3. compare `target.runtime` and `target.runtimeVersion` with the runtime they
   will actually boot;
4. require `runtimeEvidence: true` when making runtime claims;
5. verify each evidence entry's `sha256` against the recursively key-sorted,
   compact JSON form of the referenced evidence object;
6. inspect `fail`, `warn`, and `pending` checks rather than relying only on the
   top-level status;
7. retain the last verified stable report as a rollback reference;
8. cache responses but revalidate when npm channel or runtime versions change.

## Minimal policy example

```js
const response = await fetch("https://haya-inc.github.io/clawsembly/data/release-history.json");
if (!response.ok) throw new Error(`Compatibility index unavailable: ${response.status}`);

const history = await response.json();
if (history.schemaVersion !== 1) throw new Error("Unsupported compatibility schema");

const stable = history.releases.find((release) => release.channel === "stable");
if (!stable?.runtimeEvidence || stable.checks.fail > 0) {
  throw new Error(`OpenClaw ${stable?.version ?? "stable"} is not runtime-verified`);
}
```

This policy deliberately allows warnings while rejecting missing runtime
evidence and explicit failures. A downstream project with a stricter threat
model may also reject `partial` or any nonzero pending count.

## Evidence-bound SDK loading

Display consumers may revalidate the channel index, but an application that can
boot BrowserPod must pin one exact report in reviewed source. Use the SDK loader
to bind the HTTPS URL, raw JSON SHA-256, npm artifact, and runtime version before
creating a manifest:

```js
import { createEmbedManifest } from "@haya-inc/clawsembly";
import { loadVerifiedCompatibilityReport } from "@haya-inc/clawsembly/report-loader";

const verifiedReport = await loadVerifiedCompatibilityReport(reportExpectation);
const manifest = createEmbedManifest({ report: verifiedReport, capabilities });
```

Updating `reportExpectation` is a review event, not a runtime “latest” lookup.
Redirects, credentials in URLs, query/fragment aliases, non-JSON responses,
payloads over 1 MB, digest drift, artifact/runtime drift, and inconsistent
supported claims fail before the manifest becomes launchable.

## Trust boundary

The JSON is a published observation, not a substitute for pinning npm integrity
or for a downstream project's own acceptance tests. Runtime evidence is attached
only to the exact OpenClaw version and runtime identity named inside that
evidence. Clawsembly's report schema accepts only BrowserPod, and the embedding
manifest also requires the exact BrowserPod adapter version.
BrowserPod source evidence additionally binds the exact browser string and npm
SHA-512, and requires log, portal, `/healthz`, and `/readyz` readiness before
the boot check passes. The checked-in validator also schema-checks the source evidence, verifies its
canonical SHA-256 digest, and recomputes every evidence-derived check status so
that edited or stale reports fail CI.
The packed SDK performs the corresponding raw-byte/source/identity check for
external hosts; HTTPS transport alone is not treated as report authorization.
