# Clawsembly

> Verified OpenClaw embedding for the browser.

[![CI](https://github.com/haya-inc/clawsembly/actions/workflows/ci.yml/badge.svg)](https://github.com/haya-inc/clawsembly/actions/workflows/ci.yml)
[![Compatibility probe](https://github.com/haya-inc/clawsembly/actions/workflows/compatibility.yml/badge.svg)](https://github.com/haya-inc/clawsembly/actions/workflows/compatibility.yml)
[![Browser runtime](https://github.com/haya-inc/clawsembly/actions/workflows/runtime-browser.yml/badge.svg)](https://github.com/haya-inc/clawsembly/actions/workflows/runtime-browser.yml)
[![OpenClaw browser compatibility](https://haya-inc.github.io/clawsembly/data/compatibility-badge.svg)](https://haya-inc.github.io/clawsembly/#compatibility)
[![License: MIT](https://img.shields.io/badge/license-MIT-b8ff3d.svg)](LICENSE)

[![Clawsembly — OpenClaw, verified in the browser](apps/web/public/social-preview.png)](https://haya-inc.github.io/clawsembly/)

Clawsembly is an unofficial, capability-safe embedding layer for upstream
[OpenClaw](https://github.com/openclaw/openclaw). It binds the exact published
package to public compatibility evidence, a browser-local runtime, and explicit
host capabilities. It does not reimplement the agent loop and it is not a
generic wrapper around a browser sandbox.

The project is in an experimental compatibility-lab phase. It is not affiliated
with or endorsed by the OpenClaw project.

## Product boundary

BrowserPod supplies browser-local Node execution. Clawsembly supplies the parts
an embedding application still needs in order to trust upstream OpenClaw:

- exact-version compatibility reports and reproducible failure fixtures;
- a default-deny capability broker for secrets, identity, storage, provider
  traffic, notifications, and future host APIs;
- an evidence-bound embed manifest that rejects runtime-provider mismatch;
- the generated Gateway client and narrow compatibility adapters.

The implemented broker supports exact scopes, call limits, expiry, revocation,
cancellation, bounded metadata-only audit, and redacted handler errors. The
protected provider smoke-test path now crosses that broker. The embed-manifest
core and `bootVerifiedEmbed` select BrowserPod but correctly block verified
launch before token consumption while no owner-authorized BrowserPod runtime
evidence exists. The BrowserPod adapter implements documented Node 22 boot,
`storageKey` persistence, long-running output readiness, HTTPS portal discovery,
and bounded file I/O. A typed filesystem mailbox now connects the untrusted
guest to the exact-scope broker with replay defense, byte limits, generic
errors, cancellation, and payload-free audit. Verified boot automatically
stages and reads back a generated SHA-256-pinned Node client in the fresh
channel, while a release check rejects generated-source drift. The readiness
harness installs the exact SHA-512 npm artifact and requires Gateway log,
portal, `/healthz`, `/readyz`, and a nonce-bound guest-supervisor shutdown. No
owner-authorized BrowserPod record has been captured yet. Its public 2.12.1 API
has no documented terminal-input, provider-termination, or hard-disposal
method, so those features remain explicitly unsupported. See
[ADR 0003](docs/decisions/0003-verified-openclaw-embedding.md) and the
[embedding contract](docs/embedding.md). The capture and attachment procedure
is documented in [BrowserPod evidence](docs/browserpod-evidence.md).
The transport boundary is documented in
[Capability mailbox](docs/capability-mailbox.md).

## Browser runtime direction

Browser-local execution is a product invariant; a remote sandbox is not the
replacement path. [BrowserPod](https://browserpod.io/docs/overview) is the only
active embedded provider in the application, public compatibility target, and
normal CI path. It is not called supported until it reproduces the full Gateway,
broker, tool, recovery, cancellation, persistence, performance, and licensing
evidence in
[ADR 0002](docs/decisions/0002-commercial-browser-runtime.md).
[container2wasm](https://github.com/container2wasm/container2wasm) is retained
as an archived feasibility result after its measured boot failure.

## Current evidence

The first implementation is a static compatibility inspector and a public,
report-driven project page. For the pinned `openclaw@2026.6.11` artifact it
records package integrity, Node requirements, artifact size, lifecycle scripts,
and platform-specific dependency risks without executing install scripts.
The same page tracks the npm `latest`, previous stable, and `beta` channels as
separate reports. At the 2026-07-12 snapshot those resolve to `2026.6.11`,
`2026.6.10`, and `2026.7.1-beta.5`. All three public reports now target
`browserpod@2.12.1`, contain zero runtime evidence, and remain `probing`. A
scheduled workflow skips unchanged channels and opens or updates a generated
report pull request when a channel moves.

The page contains no WebContainer import, fallback, probe control, or
StackBlitz CSP permission. Browser-host vault, identity, budget, and consent
checks remain provider-free and do not boot a guest runtime or contact OpenAI.

Earlier WebContainer Gateway, tool, reconnect, cancellation, identity,
persistence, and performance artifacts remain under the evidence and adapter
directories only as historical reproduction material. They are not attached
to current reports, included in the production dependency graph, or run by the
normal release gate. This preserves audit history without allowing legacy
provider evidence to influence BrowserPod support.

The page provides a credential-and-explicit-consent gate for one fixed-prompt
`gpt-5.6-luna` live smoke test. It enforces `store:false`, 128 maximum output
tokens, a displayed $0.001 upper bound based on the
[official API pricing](https://developers.openai.com/api/docs/pricing#text-tokens),
cancel control, and completed plain-text output only. Live network execution
has not been performed. Remote approval, token rotation and revocation, general
workspace recovery, and the broader BrowserPod matrix remain experimental, so
the release is reported as `probing` rather than production-compatible.

- [Project page](https://haya-inc.github.io/clawsembly/)
- [Checked-in compatibility report](apps/web/public/data/compatibility.json)
- [Release-channel history](apps/web/public/data/release-history.json)
- [Report schema](packages/compatibility/report.schema.json)
- [Release-history schema](packages/compatibility/release-history.schema.json)
- [Downstream consumption guide](docs/consuming-reports.md)
- [Maintainer release checklist](docs/releasing.md)
- [Deployment requirements](docs/deployment.md)

## Quick start

Requirements: Node.js 22.19 or newer.

```bash
npm install
npm run check
npm run dev
```

The long browser lane requires Playwright Chromium and performs the complete
install, Gateway, device signature, local Control UI pairing, encrypted
device-token reconnect, chat, tool, history, cancellation, and versioned OPFS
recovery:

```bash
npx playwright install chromium
npm run test:browser
```

Generate a fresh static report for an exact upstream release:

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --host-evidence apps/web/public/data/evidence/webcontainer-host.json \
  --gateway-evidence apps/web/public/data/evidence/openclaw-2026.6.11-gateway.json \
  --output apps/web/public/data/compatibility.json
```

The inspector downloads and reads the npm tarball in a temporary directory. It
does not install the package or execute lifecycle scripts.

Resolve and inspect the current stable, previous stable, and preview channels:

```bash
npm run compat:track -- \
  --host-evidence apps/web/public/data/evidence/webcontainer-host.json \
  --gateway-evidence apps/web/public/data/evidence/openclaw-2026.6.11-gateway.json
```

Runtime evidence is attached only when its embedded OpenClaw version exactly
matches the inspected artifact. `--skip-unchanged` leaves every generated file
untouched when all three resolved channels are unchanged.

## Goals

- Run upstream OpenClaw rather than maintaining an independent agent rewrite.
- Make OpenClaw safe to embed through exact artifact identity, evidence-bound
  launch, and explicit browser-host authority.
- Keep the useful default browser-local, with an optional native Gateway
  interoperability mode rather than a remote-sandbox dependency.
- Expose browser limitations as explicit capabilities instead of silently
  emulating unavailable host features.
- Detect and validate upstream releases automatically.
- Keep local data and execution inside browser security boundaries where
  possible.

## Documentation

- [Documentation index](docs/README.md)
- [Project vision](docs/vision.md)
- [Prior-art survey](docs/prior-art.md)
- [Proposed architecture](docs/architecture.md)
- [Upstream compatibility strategy](docs/upstream-compatibility.md)
- [Initial roadmap](docs/roadmap.md)
- [Product and adoption strategy](docs/product.md)
- [OSS success strategy](docs/oss-strategy.md)
- [Risk register](docs/risk-register.md)
- [Security model](docs/security-model.md)
- [Commercial browser runtime decision](docs/decisions/0002-commercial-browser-runtime.md)
- [Verified OpenClaw embedding decision](docs/decisions/0003-verified-openclaw-embedding.md)
- [Verified embedding contract](docs/embedding.md)

## Contributing

Compatibility work is most useful when it is small and reproducible. Good first
contributions include dependency classifications, browser failure fixtures,
report-schema improvements, and capability-specific adapters. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Security issues
must follow [SECURITY.md](SECURITY.md).

## Status

The first end-to-end compatibility slice is implemented and reproducible from
the project page. It is a probe, not a production runtime: the credential vault
and OpenClaw broker turn prove the complete secret boundary with mock transport,
and a protected fixed-prompt live smoke path is enabled behind credential and
explicit-consent gates. No live provider request has been executed in the
checked-in evidence yet.
Backup/export controls currently apply only to the deterministic mock-state
snapshot and deliberately exclude credentials. Browser-owned device signing,
local Control UI pairing, encrypted token retention, and token reconnect are
verified against the real Gateway. Remote approval, rotation, revocation, and
recovery remain future work.

## License

[MIT](LICENSE)
