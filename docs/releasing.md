# Maintainer release checklist

Clawsembly is currently an experimental compatibility lab. A public repository
push and a GitHub release are separate decisions from proving a browser result.

## Before the first public implementation push

1. Run `npm run release:check`.
2. Run `npm run test:browser`; verify the page and browser-host suite makes no
   guest-runtime or live-provider request.
3. Review every generated report and confirm that runtime evidence names the
   same OpenClaw version as the report receiving it.
4. Review the exact-marker source patch and ensure marker drift fails closed.
5. Confirm that no API key, device token, private key, OPFS snapshot, or
   Playwright output is staged.
6. Commit through a reviewable branch and open a draft pull request; do not push
   an unreviewed compatibility claim directly to `main`.
7. Run `npm run sdk:check`; if preparing a release asset, run `npm run sdk:pack`
   and verify the generated `.tgz` against its adjacent `.sha256` file.
8. When the stable report bytes change, review the full report and update the
   external host's URL/SHA-256/artifact/runtime pin in the same change; CI must
   reject an unreviewed pin drift.

## GitHub repository setup

- Enable GitHub Pages with **GitHub Actions** as the build source.
- Allow Actions to create pull requests if automated release tracking should
  open its fixed-branch update PR.
- Require the `CI` and `browser-host-page` checks on `main`.
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

## Release evidence

Attach the compatibility JSON, release-history JSON, and successful
`browser-host-page-diagnostics` Actions artifact to release notes. A source-SDK
prerelease may also attach the generated tarball and checksum, clearly stating
that npm publication and verified BrowserPod boot remain unavailable. State
warnings and pending checks in prose; do not summarize a `partial` result as
supported.
