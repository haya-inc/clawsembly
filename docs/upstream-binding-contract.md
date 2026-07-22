# Upstream binding contract

Status: first written 2026-07-13, per [ADR 0004](decisions/0004-upstream-portable-embedding-boundary.md).
Refocused 2026-07-22 by
[ADR 0006](decisions/0006-openclaw-specialist-refocus.md): this contract and
the hello-agent reference binding are retained as the test infrastructure
that keeps the embedding core upstream-portable; no second real binding is
planned in this repository.

Clawsembly separates an upstream-agnostic embedding core from an upstream
binding. This document states what any binding must supply before its upstream
can be presented through the verified embedding surface. It is a design
contract for the repository, not a stable plugin API: the shapes below may
change before 1.0, and satisfying them requires changes inside this repository
today.

Honesty constraint: OpenClaw is the only bound real agent. The `hello-agent`
reference binding below exists solely to prove the core is upstream-portable
in tests; nothing in this document claims another real agent already runs.

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

The proof of this contract is deliberately small and now exists: the
`hello-agent` reference binding (`packages/hello-agent-binding/`). It supplies
each requirement above for a trivial upstream:

1. **Exact artifact identity** — `clawsembly-hello-agent`, an in-repository
   fixture packed to a byte-reproducible tarball whose name, exact version,
   SHA-512 integrity, and per-file digests are pinned in a generated module
   (`npm run hello-agent:check` rejects fixture drift). It is deliberately
   `private: true` and not on any registry; the identity machinery treats it
   exactly like a registry artifact. Growing the fixture is a version bump
   plus regenerated pins — the internal growth path of
   [ADR 0005](decisions/0005-reference-agent-growth-paths.md) — never an
   in-place mutation.
2. **Boot recipe** — digest-verified staging (nothing executes before every
   file matches its pin), two deterministic readiness signals (the
   `[hello-agent] ready` log line and a parseable session record that also
   names its capability transport), and shutdown through the generic
   nonce-bound cooperative supervisor. Partial capability wiring is a boot
   failure, not a degraded mode.
3. **Protocol client** — a bounded surface pinned to the artifact's protocol
   descriptor hash (`clawsembly-hello/2`): `hello.say` plus the
   OpenClaw-shaped `chat.send`, `chat.history`, and `chat.abort`, with a
   validated delta/done event stream and in-flight abort; descriptor drift
   fails closed. The guest mints a session token at boot that every request
   must present and that the client holds in memory only.
4. **Capability requirements** — a non-empty declaration
   (`HELLO_AGENT_CAPABILITY_REQUIREMENTS`) derived from the artifact's own
   descriptor: `chat.send` delegates every completion to the host capability
   `chat.complete` (scope `provider:reference`) through the staged,
   digest-pinned mailbox client. The agent holds no provider access of its
   own; without wiring, chat fails closed as `capability_unavailable`, and
   without a grant it fails closed as `capability_denied`. This is the
   external extension path: the embedding application changes what the agent
   can do by supplying handlers and grants, not by patching the agent.
5. **Evidence gates** — a minimal gate that accepts only records bound to the
   exact artifact identity with verified staging, both readiness signals
   including a live capability transport, hello and chat round trips, at
   least one denied and one allowed capability outcome across the boundary,
   and an acknowledged cooperative stop; check statuses derive as `pending`
   without such a record.

Its tests boot the staged fixture as a real Node child process behind a local
provider double implementing the documented BrowserPod 2.x surface — no
metered provider tokens — and drive the unmodified core end to end:
verified-report loading, embed-manifest creation, the fail-closed launch
assertion, the capability broker, consent approval, denial, revocation,
mid-turn cancellation across the typed mailbox, payload-free audit, and the
shared session lifecycle, all for a package that is not OpenClaw.

Its purpose is to demonstrate that the core does not hard-code OpenClaw
specifics and that the boundary extends an agent from the outside, not to
support a second real agent: hello-agent carries no BrowserPod runtime
evidence, never appears in published reports or Pages, and statements about
running other real agents remain claims about this contract, not about
shipped capability.
