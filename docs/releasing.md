# Maintainer release checklist

Clawsembly is currently an experimental compatibility lab. A public repository
push and a GitHub release are separate decisions from proving a browser result.

## Before the first public implementation push

1. Run `npm run release:check`.
2. Run `npm run test:browser`; verify the page and browser-host suite makes no
   guest-runtime or live-provider request.
3. Review every generated report and confirm that runtime evidence names the
   same OpenClaw version as the report receiving it.
4. Confirm that no API key, device token, private key, OPFS snapshot, or
   Playwright output is staged.
5. Commit through a reviewable branch and open a draft pull request; do not push
   an unreviewed compatibility claim directly to `main`.
6. Run `npm run sdk:check`; if preparing a release asset, run `npm run sdk:pack`
   and verify the generated `.tgz` against its adjacent `.sha256` file.
   During an intentional SDK version bump, run `npm run sdk:lock` once and
   review the package manifest, starter URL, version, and SHA-512 lock diff.
7. When the stable report bytes change, run `npm run report-pin:generate` and
   review the full report plus generated URL/SHA-256/artifact/runtime pin in the
   same change; CI must reject stale or hand-edited pin drift.

## GitHub repository setup

- Enable GitHub Pages with **GitHub Actions** as the build source.
- Allow Actions to create pull requests if automated release tracking should
  open its fixed-branch update PR.
- Automated report pull requests from `compatibility.yml` are opened with the
  workflow `GITHUB_TOKEN`, so required checks do not start on them
  automatically. Close and reopen the pull request, or push an empty commit to
  its branch, to trigger them; a GitHub App or fine-grained PAT for the
  tracker is the durable alternative.
- Require the `CI` and `browser-host-page` checks on `main`.
- Keep both required checks unconditional for pull requests; a path-filtered
  required workflow leaves unrelated contributor PRs permanently `expected`.
- Enable auto-merge, automatic head-branch deletion, and contributor branch
  updates. Keep strict checks, conversation resolution, force-push protection,
  and admin enforcement enabled.
- Enable private vulnerability reporting.
- Create the `compatibility`, `needs-triage`, and `good first issue` labels used
  by contribution workflows.
- Confirm that CODEOWNERS resolves to an active maintainer and review the first
  Dependabot pull request before enabling auto-merge.
- Set the repository homepage to `https://haya-inc.github.io/clawsembly/` only
  after the Pages deployment returns HTTP 200.

## First prerelease

The first tag should remain a prerelease until all of these hold:

- the public project page loads its checked-in report and release history;
- stable runtime evidence is reproducible from a clean supported browser;
- an upstream issue exists for every required source patch;
- one previous stable result is retained as rollback evidence;
- BrowserPod licensing, metering, delivery, and exit-path decisions are documented;
- at least one external integrator has reviewed the report contract;
- the packed SDK passes isolated ESM and strict TypeScript consumer checks.

## Owner-authorized BrowserPod evidence

Provider evidence is never part of the normal release check. Configure the
`browserpod-evidence` GitHub Environment with required reviewers and an
Environment-scoped `BROWSERPOD_API_KEY`, then manually dispatch
`Browser host, page, and evidence` with `capture_browserpod` enabled. Review the
downloaded artifact before placing it under `apps/web/public/data/evidence/`.
Follow [the BrowserPod evidence runbook](browserpod-evidence.md) to regenerate
reports and the SDK pin; never hand-edit a green status.

## Release evidence

Attach the compatibility JSON, release-history JSON, and successful
`browser-host-page-diagnostics` Actions artifact to release notes. A source-SDK
prerelease may also attach the generated tarball and checksum, clearly stating
that npm publication and verified BrowserPod boot remain unavailable. State
warnings and pending checks in prose; do not summarize a `partial` result as
supported.

Pushing a tag that exactly matches `v` plus the SDK package version runs the
source-prerelease workflow. The read-only build job repeats `npm run
release:check`, creates the release assets and provenance, and packages the
provider-free browser diagnostics. A separate `contents:write` job accepts only
the fixed artifact allowlist, rejects traversal and symlinks, checks the SDK
checksum, executes no npm code, and publishes the tag as a prerelease. A version
bump must deliberately update the package, schema, and workflow allowlist
together.

## Version bump checklist

A prerelease version bump touches every location below in one reviewed
change. Each entry names how it is kept honest:

- `packages/sdk-package/package.json` — manual; the packed version that names
  the release tag.
- `packages/sdk-package/README.md` — manual; the prepared-version sentence
  and both tarball URLs (Pages and GitHub Release).
- `examples/sdk-host/README.md` — manual; the checkout-install tarball
  filename.
- `examples/sdk-host/package.json` and `package-lock.json` — regenerated by
  `npm run sdk:lock` from the newly packed bytes; never hand-edited.
- `packages/compatibility/npm-publication.json` — manual; status returns to
  `pending` until the next publication is reviewed.
- `.github/workflows/sdk-release.yml` — manual; the asset-name literals,
  validated by `npm run check`.
- `SECURITY.md` — manual; the supported-versions table follows the latest
  source prerelease.
- `CHANGELOG.md` — manual; the dated heading for the version being released.
- `README.md` and `README.ja.md` — manual; the npm-alpha status row, the
  source-prerelease links, and the install-command versions.
- `docs/roadmap.md` and `docs/oss-strategy.md` — manual; the
  distribution-state paragraphs that name released and prepared versions.
- `.github/ISSUE_TEMPLATE/support.yml` — manual; the release placeholder.

## npm pack reproducibility

The byte-reproducible pipeline assumes the npm CLI's tar output stays stable.
CI floats Node 24.x, so an npm update that changes tar bytes makes every
release gate fail for existing tags: the rebuilt tarball no longer matches
the recorded checksums. The remediation is to bump to the next prerelease
version and tag that; never mutate a published tag.

## npm publishing

After publishing the GitHub prerelease, `.github/workflows/sdk-release.yml`
explicitly dispatches `.github/workflows/npm-publish.yml`. The npm workflow's
`release.published` trigger remains a fallback for releases created outside the
tag workflow because events created with `GITHUB_TOKEN` do not recursively
start ordinary event workflows.
The job checks out the exact tag, pins npm CLI, repeats the complete release
gate, downloads the GitHub Release tarball and provenance record, and requires
those bytes to match the locally rebuilt package before publishing under the
`alpha` dist-tag. It is idempotent only when the registry integrity matches.
The step judges success by the final registry state, not by the `npm publish`
exit code alone: it polls the exact-version registry endpoint for up to five
minutes of propagation delay and reports green only when the served integrity
matches the verified release — including when `npm publish` itself failed
because the version already existed. If a run goes red because the registry
never became visible in time, re-running the workflow re-verifies the
published bytes without publishing again.

The first package publication requires an Environment-scoped granular
`NPM_TOKEN` because npm trusted publishing cannot be configured before the
package exists. The token enters only the final publish step. After the
bootstrap publication, configure `npm-publish.yml` as the package's GitHub
trusted publisher, retain `id-token: write`, remove `NPM_TOKEN`, and restrict
traditional token publishing. GitHub-hosted OIDC publication automatically
attaches npm provenance; the explicit `--provenance` flag also protects the
bootstrap release.

`packages/compatibility/npm-publication.json` is the reviewed publication
record. Keep it `pending` in a release tag. After npm confirms the exact
registry integrity and provenance, change it to `published` with the matching
SHA-512 integrity, publication time, and Sigstore log URL. Pages and its SDK
manifest derive their npm status and install command from this file.

## Graduation criteria (alpha → beta → stable)

Recorded 2026-07-22 so the prerelease posture is a decision, not a habit.
Coordinated promotion stays deferred until the alpha label is gone
(owner decision of 2026-07-22).

Every release so far is `0.1.0-alpha.N` because the flagship promise —
evidence-gated browser-local OpenClaw — is vendor-gated: the BrowserPod
guest Node trails the artifact's engines floor
([#6](https://github.com/haya-inc/clawsembly/issues/6)) and ships no
`node:sqlite` binding
([#47](https://github.com/haya-inc/clawsembly/issues/47)), so every
published browser-runtime report stays `probing` and `bootVerifiedEmbed`
fails closed by design. A stable label on an SDK whose flagship path
cannot run would contradict the project's own evidence rules.

**Beta requires** the flagship path to exist in reality:

- the vendor gaps close and one owner-authorized BrowserPod capture of a
  tracked OpenClaw release passes the ADR 0002 acceptance gates, flipping
  a published report from `probing` to `supported` (the capture harness
  is kept dispatch-ready for that day);
- the wrap surfaces that exist today — native-Gateway evidence lane,
  remote mode with device management — keep their evidence classes and
  honesty constraints intact through that flip.

**Stable additionally requires** promises this repository can only earn
over time:

- the public SDK surface (manifest/boot plus the published subpaths)
  survives at least one full upstream stable cycle, including a
  regenerated Gateway contract, without a breaking change to embedders;
- the changelog drops its "does not yet promise semantic-version
  compatibility" disclaimer and states a semver policy, including how
  version-locked contract regenerations map onto majors/minors;
- at least one external consumer runs against the published package or
  report endpoints ([#9](https://github.com/haya-inc/clawsembly/issues/9));
- remote-mode pairing review has been exercised against a Gateway
  configuration that actually raises a pending pairing request.

An alternative exists and is a positioning decision, not an engineering
one: redefining the wrap surfaces as the product and browser-local
execution as a future capability would justify a beta without the vendor.
That path requires its own ADR; until then the flagship definition of
ADR 0006 stands.
