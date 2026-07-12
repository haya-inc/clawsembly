# Initial roadmap

The roadmap prioritizes evidence about upstream compatibility before product UI
or a broad feature set.

## Phase 0: feasibility gate and compatibility lab

Deliverables:

- project documentation and contribution baseline;
- a checked-in compatibility-report schema and static artifact inspector;
- a report-driven public project page;
- browser-local commercial-runtime decision;
- an earlier browser-runtime Node-version capture, retained in Git history;
- a minimal current-stable OpenClaw install and boot attempt;
- structured capture of install, stdout, stderr, and browser errors.

Exit criterion: CI publishes a machine-readable current-stable report and can
either reach the Gateway handshake in a browser-local runtime or retain a
reproducible, classified blocker. A trivial Node service alone is not
sufficient evidence.

Status: achieved locally for `openclaw@2026.6.11`; the checked-in evidence
includes server readiness, `/healthz`, and protocol 4 `hello-ok`.

## Phase 1: current stable OpenClaw probe

Target the exact current stable npm artifact, initially `2026.6.11` from the
2026-07-12 survey.

Deliverables:

- dependency and Node built-in inventory;
- minimal OpenClaw configuration;
- browser-safe unique device identity generation;
- explicit adapters or errors for eager native dependencies;
- Gateway startup and health checks;
- a generated supported/unsupported capability report.

Exit criterion: the Gateway either boots without an upstream source patch, or
the smallest unavoidable patch and its upstream issue are documented.

Historical status: the pinned release booted on the removed runtime with one
fail-closed exact-marker patch for Ed25519 verification. That adapter and patch
were deleted during the BrowserPod-only cutover. The result remains useful as
history but does not provide BrowserPod support evidence.

This phase also introduces stable-release detection and the minimal automated
report workflow. Release tracking is part of the product from the first probe,
not a later maintenance enhancement.

## Phase 2: protocol client and chat

Deliverables:

- browser client generated from the matching Gateway schema;
- embedded and remote runtime selection;
- device pairing and authentication flow;
- streamed chat, cancellation, history, and reconnect behavior;
- mocked protocol contract tests across supported versions.

Exit criterion: one UI can complete the same basic chat workflow against both
an embedded Gateway and a native Gateway.

Status: partial. Browser-owned Ed25519 identity signs the exact v3 challenge and
the generated client validates `hello-ok`. The embedded controller now re-reads
the exact OpenClaw pending list, refuses device/role/scope drift, and exposes a
five-minute one-shot owner approve/reject prompt. Issued tokens are encrypted
under a non-extractable AES-GCM key bound to artifact/device/role/scopes and are
used for signed reconnect; a rejected stale token is cleared. Streamed chat,
cancellation, history, pairing, and reconnect pass provider-free contract
tests. Owner-authorized BrowserPod evidence, remote-mode parity, remote
approval, rotation, revocation, recovery, and automatic retry remain.

## Phase 3: persistence and constrained tools

Deliverables:

- OPFS workspace persistence and recovery;
- IndexedDB application metadata;
- encrypted provider credentials;
- workspace backup and restore;
- constrained file, fetch, and code-execution tools;
- auditable capability approvals.

Exit criterion: a browser restart restores a session and workspace without
persisting plaintext secrets or accessing files outside the granted scope.

Status: partial. Versioned mock-state recovery and the encrypted browser-host
credential vault pass in Chromium. A real OpenClaw agent turn now crosses the
fixed-destination browser-host broker with mock transport and no API-key exposure
to the guest. Typed text deltas reach OpenClaw, a streamed `agents_list`
function call is translated and executed, and its matched result is serialized
as Responses `function_call` / `function_call_output` input for the second
provider request. `chat.abort` cancels the browser request and provider stream.
User-configurable request/input/output budgets are enforced and reported by the
browser host. A fixed-prompt live smoke-test UI is credential- and consent-gated,
cost-bounded, cancellable, and complete-output-only; automation proves the gate
without making a live request. User-workspace migration fixtures, the first
owner-authorized live execution and broader moderation UX remain. The first
default-deny capability broker now enforces exact artifact subjects, scopes,
call limits, expiry, revocation, cancellation, and payload-free audit. The typed
guest transport and reusable permission prompt are integrated; workspace
migration and owner-authorized provider evidence remain.

The removed Chromium runtime measured a 57.1-second cold install, including
49.7 seconds for a 293-package nested repair, a 2.9-second warm reinstall,
618.5 MB of `node_modules`, 261.6 MB of npm cache, and 16.4 seconds to Gateway
protocol readiness. These remain historical comparison data only. BrowserPod
cold, warm, persistent-reuse, and Gateway-ready measurements are absent and
must be captured before setting performance budgets. The static inspector still
detects published shrinkwrap root declaration drift without implying that the
removed repair path remains active.

### Phase 3b: BrowserPod runtime integration

Status: implementation complete; provider evidence pending. Replace the
superseded production boundary without moving execution to a server:

- remove the superseded runtime from the application, dependency graph,
  compatibility target, fixtures, evidence, and CI; retain history in Git and
  the decision log rather than executable main-branch code;
- use BrowserPod as the selected embedded production target while keeping its
  support status blocked on runtime evidence;
- verify BrowserPod Node 22.19+, crypto, SQLite, long-lived Gateway process I/O,
  portal routing, persistence, cancellation, and commercial terms;
- retain the 316.7 MB container2wasm boot failure as an archived feasibility
  result rather than splitting current implementation effort;
- introduce one provider-neutral runtime contract;
- promote no candidate until it reproduces the full Gateway evidence slice.

Exit criterion: one commercially deployable browser-local provider passes the
same health, handshake, turn, tool, history, abort, reconnect, and restore
evidence as the baseline. Remote execution does not satisfy this criterion.

Status: the BrowserPod adapter contract now covers documented boot, persistent
storage, bounded terminal output/readiness, long-running command tracking,
HTTPS portal discovery, and bounded file I/O. The exact-artifact readiness
harness now composes preflight, npm SHA-512 verification, real Gateway log and
portal readiness, and guest-local `/healthz` plus `/readyz` into a versioned
evidence schema, then requires a nonce-bound cooperative Gateway stop. Its
fake-provider end-to-end path and report attachment pass; an owner-authorized
commercial run is still required. The public 2.12.1 API exposes no terminal
input, provider process termination, or hard disposal. The supervisor closes
only Clawsembly-launched cooperative children and does not overstate those
provider capabilities.

### Phase 3c: verified embedding SDK

Turn the compatibility and host-security work into a reusable integration
surface:

- bind every launch to exact OpenClaw version, integrity, report, and runtime;
- expose only explicit capability grants through the browser-host broker;
- add a typed BrowserPod guest transport and lifecycle adapter;
- add permission, expiry, revocation, and audit UX;
- publish a minimal `Clawsembly.boot({ manifest, browserPodApiKey })` API only
  after `assertVerifiedLaunch` passes against BrowserPod evidence.

Status: manifest generation, fail-closed verified-launch assertion, and
`bootVerifiedEmbed` are implemented. Verified boot now initializes a fresh
per-session typed filesystem mailbox bound to the same exact broker subject.
It automatically stages and reads back a generated SHA-256-pinned guest client;
the release gate rejects drift from its canonical sources. Real-filesystem
tests execute that staged Node client and cover allow, deny, replay,
cancellation, strict parsing, and response limits. A headless consent
controller now keeps manifest requests pending until exact user approval,
bounds call count and duration, supports deny/revoke/expiry, and exports current
state plus combined broker audit under stable schemas. A reusable rendered
prompt component now exposes the same controller through bounded duration/call
inputs, exact approve/deny/revoke controls, automatic expiry refresh, and
explicit payload-free audit download. Its public demo uses an inert local broker
and invokes no capability. The public reports now
target `browserpod@2.12.1` and remain `probing` with no attached runtime
evidence, so boot is correctly rejected before token consumption. The boot
session now also exposes the same exact-artifact installer used by the evidence
probe; it aggregates concurrent calls and verifies installed manifest plus
package-lock integrity before returning executable paths. A shared Gateway
controller now adds token-private supervised launch, log/portal readiness,
guest-local health/readiness, exact browser-origin configuration, explicit
trusted-host connection material, and cooperative stop. The first
generated-client slice is artifact-bound: it persists a non-extractable
Ed25519 device identity, signs the protocol 4 challenge, sends the shared token
only in the connect frame, validates and redacts `hello-ok`, and exposes bounded
explicit-pairing metadata. The declared source entrypoint now exports the same
boot helpers at ESM runtime and is protected by an exact consumer export test.
Provider-free contract tests pass;
the post-authentication client now limits itself to chat send/history/abort,
forces local-only delivery, validates streamed chat events, detects gaps,
rejects pending RPCs on disconnect, and supports an explicit fresh signed
reconnect. Exact local pending-request review, explicit approve/reject UI,
encrypted issued-token persistence, device-token reconnect, and stale-token
clearing also pass provider-free tests. Owner-authorized BrowserPod
handshake/pairing/turn evidence, automatic retry, remote approval, token
rotation/revocation/recovery, and attachments remain. Ordered session close now prevents logical runtime disposal from
cutting off an active Gateway's cooperative stop path. The boot slice is not promoted as supported while
owner-authorized BrowserPod evidence remains missing.

The repository now also produces a byte-reproducible
`@haya-inc/clawsembly@0.1.0-alpha.0` tarball without making the compatibility lab
itself publishable. CI installs that tarball into an isolated ESM/TypeScript
consumer, verifies every declared public subpath, and builds an independent
host application from the packed dependency with no workspace alias. Its
provider-free browser test renders the exact artifact/runtime/blockers and
proves that the current `probing` report leaves BrowserPod boot unattempted. A
branded loader now pins the report's exact HTTPS source, raw JSON SHA-256, npm
artifact, and BrowserPod version; raw or hand-edited `supported` objects cannot
authorize launch. The six-hour tracker deterministically rotates that pin in
its read-only job and publishes it with the report through the isolated
write-capable PR job. npm publication remains blocked on the same runtime
evidence and maintainer release gates.

Exit criterion: an external web application can embed one supported upstream
OpenClaw version without granting ambient credentials, filesystem, or network
authority, and can export its evidence-bound capability audit.

## Phase 4: harden automated upstream tracking

Deliverables:

- stable and beta release detection;
- schema, dependency, and native-addon diffing;
- browser-runtime smoke-test matrix;
- generated compatibility manifests and reports;
- automated upgrade pull requests;
- rollback to the previous verified stable release.

Exit criterion: an additive upstream stable release can be validated and
proposed without handwritten code changes.

Status: partial. The tracker resolves npm `latest`, the immediately preceding
non-prerelease version, and `beta`; emits three exact-artifact reports plus a
versioned release-history index; refuses cross-version Gateway evidence; and
skips unchanged channels. Every report now preserves its sorted direct
dependency names and specs, and the index derives exact added, removed, and
changed entries against stable for machine and project-page review. The
six-hour workflow uploads all reports and opens
or refreshes a fixed-branch pull request when a channel moves. Full runtime
execution on that pull request derives the version from the generated stable
report and retains a redacted, versioned evidence artifact on success. Promotion
of that CI artifact into the durable checked-in report, dependency risk
classification, schema/protocol diff generation, and automatic rollback
promotion remain.

## Phase 5: extensibility and broader capabilities

Possible follow-up work:

- WIT-defined Wasm tool capabilities;
- remote capability nodes for native execution;
- browser notifications and best-effort background work;
- selected HTTPS-only messaging channels;
- mobile and installable PWA support;
- a compatibility dashboard covering OpenClaw release history.

These features should not delay the compatibility harness or create a new
agent runtime inside Clawsembly.

## Immediate next tasks

1. Extend the versioned mock-state envelope to cover user workspaces and migration fixtures.
2. Execute the protected live smoke test with an owner-provided key, archive redacted evidence, and expand moderation UX.
3. Measure BrowserPod cold, warm, and persistent install paths and establish
   provider-specific latency/storage budgets.
4. Reproduce the full runtime slice on the selected commercial browser runtime.
5. Add remote-mode pairing approval, device-token rotation, revocation,
   recovery, and bridge-process hardening.
