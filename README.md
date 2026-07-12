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
launch before token consumption while only the WebContainer baseline has
runtime evidence. The BrowserPod adapter implements documented Node 22 boot,
`storageKey` persistence, long-running output readiness, HTTPS portal discovery,
and bounded file I/O. A typed filesystem mailbox now connects the untrusted
guest to the exact-scope broker with replay defense, byte limits, generic
errors, cancellation, and payload-free audit. The readiness harness installs
the exact SHA-512 npm artifact and requires Gateway log, portal, `/healthz`,
`/readyz`, and a nonce-bound guest-supervisor shutdown. No owner-authorized
BrowserPod record has been captured yet. Its public 2.12.1 API has no documented
terminal-input, provider-termination, or hard-disposal method, so those
features remain explicitly unsupported. See
[ADR 0003](docs/decisions/0003-verified-openclaw-embedding.md) and the
[embedding contract](docs/embedding.md). The capture and attachment procedure
is documented in [BrowserPod evidence](docs/browserpod-evidence.md).
The transport boundary is documented in
[Capability mailbox](docs/capability-mailbox.md).

## Browser runtime direction

Browser-local execution is a product invariant; a remote sandbox is not the
replacement path. The verified WebContainer slice below remains a regression
baseline, but it is not the selected commercial production runtime.
[BrowserPod](https://browserpod.io/docs/overview) is the adopted embedded
provider. It is not called supported until it reproduces the full Gateway,
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
The same page now tracks the npm `latest`, previous stable, and `beta` channels
as separate reports. At the 2026-07-12 snapshot those resolve to `2026.6.11`,
`2026.6.10`, and `2026.7.1-beta.5`; only the exact `2026.6.11` report inherits
its matching browser-runtime evidence. A scheduled workflow skips unchanged
channels and opens or updates a generated-report pull request when a channel
moves.

The real artifact now boots in a Chromium WebContainer, returns HTTP 200 from
`/healthz`, completes an authenticated protocol 4 `hello-ok` handshake, and
finishes a streamed turn through a deterministic local mock provider. The
model is restricted to one read-only tool (`agents_list`); OpenClaw executes
the call, returns its result to the provider, and completes the turn. The SQLite
adapter also recovers history after a new authenticated WebSocket and cancels
an active streamed run through `chat.abort`. Mock session state is exported as a
binary snapshot, wrapped in a versioned SHA-256-verified backup, saved in OPFS,
mounted into a fresh WebContainer, and retained after document reload. Real
OpenAI credentials can now be encrypted by a non-extractable browser-host
AES-GCM key and retained in IndexedDB without entering the WebContainer. A host
broker also constrains mock-verified provider traffic to the official Responses
endpoint with `store:false`, rejected redirects, bounded responses, and
secret-safe errors. A real OpenClaw `broker` agent now completes a final turn
through that browser-host boundary using the host-selected `gpt-5.6-luna`
model. Typed Responses SSE deltas reach OpenClaw incrementally, and
the bridge forwards the real `agents_list` schema, translates a streamed
Responses function call into `tool_calls`, observes OpenClaw return the tool
result, converts the matched history back into Responses `function_call` and
`function_call_output` input items, and completes the second provider turn.
`chat.abort` cancels the browser
`AbortController` and provider stream. User-editable session limits cap request
count, input characters, and streamed output characters in the browser host.
The same Chromium lane now publishes runtime cost instead of hiding it: cold
install is 57.1 seconds (49.7 seconds in the nested dependency repair), warm
reinstall is 2.9 seconds, `node_modules` contains 618.5 MB, npm cache contains
261.6 MB, and Gateway protocol readiness takes 16.4 seconds. These values are a
compatibility PASS but an adoption WARN until the repair and cache footprint are
reduced. Skipping redundant repair lifecycle scripts improved cold time by 4.1%;
`npm ci` cannot yet replace the repair because the published shrinkwrap is
missing 31 root development declarations required by its clean-install
validation. The static inspector now checks manifest/shrinkwrap root consistency
for every inspected release and exposes the failure in the public report.
The API credential never enters
WebContainer and the test transport does not contact OpenAI. A separate
non-extractable Ed25519 device key persists in
IndexedDB and signs the exact Gateway v3 challenge in the browser host; the
private key never enters WebContainer, and the signed connection receives
`hello-ok`. OpenClaw 2026.6.11 needs one exact-marker, fail-closed verifier
patch because WebContainer cannot construct the upstream Ed25519 public key
through `node:crypto`. The local standard Control UI path now pairs, encrypts
its issued device token in the browser vault, and reconnects with that token;
the value is never written to the page log or workspace. The page now provides
a credential-and-explicit-consent gate for one fixed-prompt `gpt-5.6-luna`
live smoke test. It enforces `store:false`, 128 maximum output tokens, a
displayed $0.001 upper bound based on the
[official API pricing](https://developers.openai.com/api/docs/pricing#text-tokens),
cancel control, and completed plain-text output only. Live network execution
has not been performed. Remote approval, token rotation and revocation, general workspace
recovery, and the broader browser matrix remain experimental, so the release
is reported as `partial` rather than production-compatible.

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
