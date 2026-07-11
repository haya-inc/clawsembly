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

Consumers should:

1. require the expected `schemaVersion`;
2. compare `artifact.version` and integrity with the artifact they will use;
3. require `runtimeEvidence: true` when making runtime claims;
4. verify each evidence entry's `sha256` against the recursively key-sorted,
   compact JSON form of the referenced evidence object;
5. inspect `fail`, `warn`, and `pending` checks rather than relying only on the
   top-level status;
6. retain the last verified stable report as a rollback reference;
7. cache responses but revalidate when npm channel versions change.

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

## Trust boundary

The JSON is a published observation, not a substitute for pinning npm integrity
or for a downstream project's own acceptance tests. Runtime evidence is attached
only to the exact OpenClaw version named inside that evidence. Clawsembly's
generator rejects attempts to reuse it for another version.
The checked-in validator also schema-checks the source evidence, verifies its
canonical SHA-256 digest, and recomputes every evidence-derived check status so
that edited or stale reports fail CI.
