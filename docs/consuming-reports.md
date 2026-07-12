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
| Release index | `https://haya-inc.github.io/clawsembly/data/release-history.json` | Stable, previous, and preview summaries, exact dependency and Gateway contract changes, and report paths |
| Promotion policy | `https://haya-inc.github.io/clawsembly/data/promotion-policy.json` | Fail-closed promote/hold decision for preview plus independent stable and rollback gates |
| Report schema | `https://haya-inc.github.io/clawsembly/schemas/report.schema.json` | Validation contract for a complete report |
| History schema | `https://haya-inc.github.io/clawsembly/schemas/release-history.schema.json` | Validation contract for the channel index |
| Promotion schema | `https://haya-inc.github.io/clawsembly/schemas/promotion-policy.schema.json` | Validation contract for the derived decision artifact |
| BrowserPod evidence schema | `https://haya-inc.github.io/clawsembly/schemas/browserpod-evidence.schema.json` | Raw exact-artifact BrowserPod readiness contract |
| SDK release | `https://haya-inc.github.io/clawsembly/downloads/sdk-release.json` | Pages tarball/checksum identity plus exact compatibility-report binding |
| SDK release schema | `https://haya-inc.github.io/clawsembly/schemas/sdk-release.schema.json` | Validation contract for the source-alpha distribution manifest |
| Source-release schema | `https://haya-inc.github.io/clawsembly/schemas/source-release.schema.json` | Validation contract for Git tag, source commit, tarball, Pages manifest, and report provenance attached to each GitHub prerelease |

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

Each release summary includes `dependencyChangesFromStable`. `added` and
`removed` preserve the exact declared package spec; `changed` preserves both
the stable and candidate specs. These are static manifest facts, not runtime
compatibility claims:

```js
const preview = history.releases.find((release) => release.channel === "preview");
for (const change of preview.dependencyChangesFromStable.changed) {
  console.log(`${change.name}: ${change.stableSpec} -> ${change.releaseSpec}`);
}
```

`dependencyRiskFromStable` covers every added or changed dependency. Each entry
binds the declared spec to the shrinkwrap-resolved version and SHA-512, reports
whether the bounded source scan was truncated, and records only observed
lifecycle scripts, native/Wasm files, Node built-ins, network APIs/package
imports, and derived browser-capability signals. An empty signal list is not a
compatibility PASS; if `scan.truncated` is true it is not even an absence claim.

`gatewayContractFromStable` compares the inspected Gateway surface without
executing OpenClaw. It includes protocol constants, legacy declaration counts,
source-digest changes, and exact `added`/`removed` lists for core methods,
schema exports, validators, and event schemas. Classification is fail-closed:
an incomplete inspection yields `incomplete`; a protocol incompatibility,
removed inventory member, or removed legacy declaration yields `breaking`.
`additive` and `unchanged` remain static contract observations and do not imply
runtime support.

```js
const gateway = preview.gatewayContractFromStable;
if (["breaking", "incomplete"].includes(gateway.classification)) {
  throw new Error(`Review OpenClaw Gateway contract: ${gateway.classification}`);
}
```

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

const preview = history.releases.find((release) => release.channel === "preview");
if (["breaking", "incomplete"].includes(preview?.gatewayContractFromStable?.classification)) {
  console.warn(`Preview promotion requires Gateway review: ${preview.gatewayContractFromStable.classification}`);
}
```

This policy deliberately allows warnings while rejecting missing runtime
evidence and explicit failures. A downstream project with a stricter threat
model may also reject `partial` or any nonzero pending count.

## Ready-to-run promotion gate

`promotion-policy.json` is deterministically derived from the validated release
history. Preview promotion is held when support status or runtime evidence is
missing, checks fail or remain pending, shrinkwrap is inconsistent, Gateway
inspection is breaking/incomplete, or a dependency scan is truncated. Stable
and previous are evaluated independently so `rollback.eligible` is never
inherited from the candidate.

```bash
# Observe without changing CI status.
node examples/release-policy/check.mjs --observe

# Fail unless the current preview is eligible.
node examples/release-policy/check.mjs
```

The copyable consumer rejects redirects, URL aliases, non-JSON content,
responses over 1 MiB, unknown reason identifiers, and contradictory decisions.
See [`examples/release-policy`](../examples/release-policy/README.md).

Downstream GitHub Actions users can skip checkout and Node setup entirely:

```yaml
- id: clawsembly
  uses: haya-inc/clawsembly/actions/promotion-policy@codex/oss-launch
  with:
    mode: observe # change to gate to require PROMOTE
```

The Action exposes `decision`, `candidate_version`, and `reasons`. Pin a
reviewed commit SHA instead of the moving development branch in production.

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
