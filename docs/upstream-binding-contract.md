# Upstream binding contract

Status: first written 2026-07-13, per [ADR 0004](decisions/0004-upstream-portable-embedding-boundary.md).

Clawsembly separates an upstream-agnostic embedding core from an upstream
binding. This document states what any binding must supply before its upstream
can be presented through the verified embedding surface. It is a design
contract for the repository, not a stable plugin API: the shapes below may
change before 1.0, and satisfying them requires changes inside this repository
today.

Honesty constraint: OpenClaw is the only implemented binding. Upstream
portability is a stated design property until a second binding exists; nothing
in this document claims another agent already runs.

## What the core provides

A binding does not reimplement these. The core owns:

- the default-deny capability broker: exact scopes, call limits, expiry,
  revocation, cancellation, metadata-only audit, and redacted handler errors
  (`packages/capability-broker/`);
- the evidence-bound embed manifest and fail-closed loader:
  `createEmbedManifest`, `assertVerifiedLaunch`, and `bootVerifiedEmbed`
  refuse launch while the bound report lacks owner-authorized runtime evidence
  (`packages/embed-sdk/`);
- the permission-prompt surface and payload-free audit export exercised on the
  project page against an inert broker;
- the typed capability mailbox connecting an untrusted guest to the broker
  with replay defense, byte limits, generic errors, and payload-free audit;
- the `BrowserRuntime` boundary: provider-agnostic `start`/`wait`/`onOutput`/
  `waitForOutput` tasks, portal observation, and bounded file I/O
  (`packages/browser-runtime/browser-runtime.mjs`), with BrowserPod as the
  committed provider behind it (ADR 0002);
- the report and release-history schemas, the promotion policy, and the
  evidence digest machinery (`packages/compatibility/`).

## What a binding must supply

### 1. Exact artifact identity

- The npm package name, an exact version, and its SHA-512 integrity.
- A resolution recipe from the public registry (stable, previous, preview
  channels) that the tracker can automate.
- Evidence records and generated clients are bound to this identity; the
  report builder rejects cross-version reuse.

The OpenClaw binding implements this in `packages/compatibility/` (channel
resolution, tarball verification) and `packages/browser-runtime/openclaw-installer.mjs`
(guest install verified against the inspected SHA-512).

### 2. Boot recipe

- Guest workspace layout and install procedure for the exact artifact, without
  skipping lifecycle scripts silently.
- Runtime requirements stated as checks (for OpenClaw: Node 22.19+,
  `node:crypto`, `node:sqlite` — `packages/browser-runtime/browserpod-preflight.mjs`).
- Deterministic readiness signals: for OpenClaw, the `[gateway] ready` log,
  an HTTPS portal, and guest-local `/healthz` and `/readyz`
  (`packages/browser-runtime/openclaw-gateway.mjs`).
- A cooperative shutdown path that does not depend on provider APIs the
  runtime does not document (OpenClaw uses a nonce-bound guest supervisor).

### 3. Protocol client

- Generated from the exact published artifact and pinned to the same
  integrity; regeneration must be reproducible and drift-checked
  (`npm run protocol:generate` / `protocol:verify` for OpenClaw).
- An authenticated handshake that never persists or serializes ephemeral
  tokens beyond their documented use.
- A bounded method surface: only the operations the embedding application
  needs are exposed (for OpenClaw: `chat.send`, `chat.history`, `chat.abort`
  after authentication), never a generic pass-through.

### 4. Capability requirements

- The host capabilities the upstream needs, each mapped to broker scopes with
  explicit grants in the embed manifest.
- Unsupported host features declared as explicit limitations that fail with
  actionable errors; silent emulation and no-op stubs are prohibited
  (vision principle "Capabilities over pretend parity").

### 5. Evidence gates

- Per-check definitions the report pipeline evaluates for this upstream:
  preflight, verified install, boot/readiness, handshake, constrained turn,
  reconnect, cancellation, persistence, and performance distributions.
- Each check passes only through schema-valid, digest-bound evidence records
  captured against the exact artifact and runtime; hand-edited green states
  are rejected by construction.
- The binding's report feeds the same promotion policy and fail-closed loader
  as every other upstream; a second binding must not weaken the gates of the
  first.

## Adding a second binding

The intended proof of this contract is deliberately small: a `hello-agent`
reference binding — a trivial published npm package with a boot recipe, a
one-method protocol surface, and a minimal evidence gate — exercised in tests
without a metered provider. Its purpose is to demonstrate that the core does
not hard-code OpenClaw specifics, not to support a second real agent. Until it
exists, statements about multi-upstream support must point at this contract,
not at shipped capability.
