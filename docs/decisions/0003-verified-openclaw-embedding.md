# ADR 0003: Make verified, capability-safe OpenClaw embedding the product

- Status: accepted
- Date: 2026-07-12

## Context

BrowserPod solves the important but generic problem of running Node and
untrusted code inside a browser. Its own product already demonstrates browser
AI coding agents. Running OpenClaw on that runtime is therefore an integration
milestone, not a durable reason for Clawsembly to exist.

Nearby projects also offer browser-native agents, editors, policies, and audit
logs. Clawsembly cannot differentiate by rebuilding those surfaces or by
shipping another independent agent loop.

The work already proven in this repository points to a narrower product:

- exact upstream OpenClaw artifact inspection and release tracking;
- real Gateway protocol and lifecycle evidence;
- browser-host ownership of credentials, identity, persistence, and provider
  traffic;
- explicit, reproducible classification of unsupported capabilities.

## Decision

Clawsembly is the verified, capability-safe embedding layer for upstream
OpenClaw in web applications.

BrowserPod 2.x is adopted as the first production-target embedded runtime.
This selects the provider; it does not mark the provider `supported` before it
reproduces the acceptance evidence in ADR 0002.

The product consists of three independently useful OSS surfaces:

1. **Compatibility evidence.** Every supported claim binds to an exact
   OpenClaw version, package integrity, runtime provider, browser baseline, and
   reproducible evidence artifact.
2. **Browser capability broker.** The OpenClaw guest, plugins, dependencies,
   and model-generated code are untrusted. Host authority is default-deny and
   exposed only through exact-scope, bounded, revocable, audited capabilities.
   Audit records contain metadata, never request payloads, results, credentials,
   or underlying exception bodies.
3. **Embedding SDK.** A host application creates a manifest that binds the
   exact artifact and compatibility report to BrowserPod and the capabilities
   granted for that session. Verified launch fails closed when evidence was
   captured for another provider or is less than `supported`.

The canonical promise is:

> Embed the current upstream OpenClaw in a browser with explicit authority and
> evidence for every compatibility claim.

## Implemented first slice

- `packages/capability-broker/capability-broker.mjs` implements exact artifact
  subjects, default deny, exact scopes, call limits, expiry, revocation,
  cancellation, bounded metadata-only audit, and redacted failures.
- `packages/embed-sdk/embed-manifest.mjs` binds a BrowserPod launch plan to an
  exact report and refuses to reuse archived evidence from another provider.
- `packages/browser-runtime/browserpod-runtime.mjs` implements documented Node
  22 boot, persistent storage, long-running output readiness, HTTPS portal
  discovery, bounded filesystem access, and honest lifecycle feature flags.
- `packages/embed-sdk/boot.mjs` asserts provider-matched supported evidence
  before spending BrowserPod tokens, then binds the runtime and broker to the
  same artifact identity.
- `packages/browser-runtime/browserpod-openclaw-probe.mjs` installs the exact
  artifact, matches its package-lock SHA-512, and requires Gateway log, HTTPS
  portal, `/healthz`, `/readyz`, and cooperative Gateway shutdown before
  emitting raw evidence.
- `packages/capability-broker/filesystem-mailbox-host.mjs` and the guest client
  carry bounded, typed, cancellable requests across BrowserPod's documented
  filesystem API while preserving the broker as the only source of authority.
- `packages/capability-broker/guest-mailbox-artifact.mjs` stages a generated,
  SHA-256-pinned client into every fresh channel, verifies its readback, and
  removes manual guest-module packaging from the integration contract.
- `packages/browser-runtime/cooperative-process.mjs` stops Clawsembly-launched
  children through a nonce-bound guest supervisor without claiming provider
  process termination or Pod disposal.
- `packages/compatibility/browserpod-evidence.schema.json` and the report
  generator bind that evidence to runtime version, browser, and artifact while
  leaving later protocol gates pending.
- the protected provider smoke-test path now passes through the capability
  broker after the report has supplied the exact OpenClaw version and integrity.
- BrowserPod boot remains behind the dependency-injected preflight until an
  owner-provided commercial API key is used to capture runtime evidence.

## Required next slices

- BrowserPod interactive input, arbitrary process termination, and hard Pod
  teardown through a documented vendor API; version 2.12.1 exposes none of
  these operations;
- an owner-authorized run of the implemented exact-artifact readiness harness;
- user-facing grant, expiry, and revocation prompts;
- exportable audit and capability manifests with a stable schema;
- a small public `boot()` SDK after BrowserPod reaches the Gateway evidence
  gate.

## Consequences

- BrowserPod is a replaceable execution dependency, not the project identity.
- A polished browser chat demo is proof of the embedding contract, not the
  primary moat.
- Compatibility reports and the capability broker remain useful to external
  integrators even if they build their own UI.
- Provider selection, runtime support, and OpenClaw support are separate claims.
- Remote sandbox execution remains optional interoperability and cannot satisfy
  the embedded product gate.

## Sources

- [BrowserPod overview](https://browserpod.io/docs/overview)
- [BrowserPod licensing](https://browserpod.io/docs/more/licensing)
- [ClawLess](https://github.com/open-gitagent/clawless)
- [OpenBrowserClaw](https://github.com/wexare-ai/openbrowserclaw)
