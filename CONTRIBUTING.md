# Contributing to Clawsembly

Thank you for helping make OpenClaw browser compatibility reproducible.

## Good first contributions

- classify an unclassified dependency or Node built-in;
- turn a browser failure into a minimal fixture;
- improve the compatibility-report schema or project page accessibility;
- document an unsupported capability with an actionable error;
- add a focused test without introducing a source fork.

Please avoid broad parity implementations or dummy packages that make startup
look successful while hiding later failures.

## Development

Requirements: Node.js 22.19 or newer.

```bash
npm install
npm run check
npm run dev
```

`npm run check` also enforces that GitHub Actions are commit-SHA pinned and that
the compatibility report generator remains read-only while only the separate
publishing job receives repository write permission.

Changes to the runtime adapter or browser probe should also run the long lane:

```bash
npx playwright install chromium
npm run test:browser
```

The same lane runs on matching pull requests, by manual dispatch, and weekly.
It builds and serves the production bundle, verifies the BrowserPod-only active
runtime gate, and exercises the provider-free project page and browser-host
security controls. It does not spend BrowserPod tokens.

Static compatibility inspection downloads but does not install or execute the
target package:

```bash
npm run compat:inspect -- --package openclaw --version 2026.6.11
```

## Pull requests

1. Open or reference an issue for behavior changes.
2. Keep each pull request to one compatibility finding or product change.
3. Include a fixture or test for failure-path changes.
4. State which capability and OpenClaw version are affected.
5. Run `npm run check`; run `npm run test:browser` when the runtime slice is affected.

Generated reports must not be edited to claim runtime success. Runtime statuses
must come from the corresponding probe evidence.

## Review principles

- upstream OpenClaw behavior remains authoritative;
- browser limitations are explicit and fail closed;
- source patches are the last resort and require an upstream issue;
- host capabilities are narrow, typed, cancellable, and auditable;
- user changes and unrelated work are preserved.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
