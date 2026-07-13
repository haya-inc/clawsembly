# Initial roadmap

The roadmap prioritizes evidence about upstream compatibility before product UI
or a broad feature set.

As of ADR 0004 (2026-07-12), the phases below serve one positioning:
Clawsembly is an evidence-gated embedding layer that runs upstream coding
agents browser-locally, behind a host boundary the embedding application
controls. OpenClaw is the first supported upstream. The dated execution plan at
the end of this document tracks the repositioning work; the phase structure and
its evidence gates are unchanged.

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
`@haya-inc/clawsembly@0.1.0-alpha.2` tarball without making the compatibility lab
itself publishable. CI installs that tarball into an isolated ESM/TypeScript
consumer, verifies every declared public subpath, and builds an independent
host application from the packed dependency with no workspace alias. Its
provider-free browser test renders the exact artifact/runtime/blockers and
proves that the current `probing` report leaves BrowserPod boot unattempted. A
branded loader now pins the report's exact HTTPS source, raw JSON SHA-256, npm
artifact, and BrowserPod version; raw or hand-edited `supported` objects cannot
authorize launch. The six-hour tracker deterministically rotates that pin in
its read-only job and publishes it with the report through the isolated
write-capable PR job. Package distribution is gated independently from runtime
support: the identical checked alpha.2 tarball is available from Pages, its
GitHub prerelease, and the npm `alpha` dist-tag now that the provenance-backed
bootstrap publication is complete, but none of those channels can turn missing
BrowserPod evidence into a supported launch. The Pages release
manifest records that distinction with exact checksums and reviewed npm
publication state, so external source-alpha consumers do not depend on registry
publication. A
fail-closed prerelease workflow repeats the complete gate on a matching Git tag,
then publishes the same bytes with provider-free browser diagnostics and a
source-commit/Pages/report provenance record from an npm-free write job.

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
tracker now also resolves every added or changed dependency through the
published shrinkwrap, verifies its exact npm SHA-512, and records bounded
script-disabled lifecycle, native/Wasm, Node built-in, network, and browser
capability signals with explicit scan completeness. The tracker also publishes
exact stable-relative Gateway protocol, distribution, method, schema,
validator, and event changes from every tracked npm tarball. At the current
snapshot, preview retains protocol 4 but is classified breaking because its
legacy declaration distribution is removed. The six-hour workflow
uploads all reports and opens
or refreshes a fixed-branch pull request when a channel moves. Full runtime
execution on that pull request derives the version from the generated stable
report and retains a redacted, versioned evidence artifact on success. Promotion
of that CI artifact into the durable checked-in report, optional/transitive
ownership classification, automatic rollback promotion, and owner-authorized
end-to-end Gateway evidence remain.

The first automatic-promotion boundary is now implemented as a derived public
policy: preview, stable, and previous are evaluated independently against
runtime evidence, support state, pending/failing checks, shrinkwrap consistency,
Gateway classification, and dependency-scan completeness. It recommends but
does not itself mutate npm tags or deployment state; automatic rollback
execution remains intentionally separate.

## Phase 5: extensibility and broader capabilities

Possible follow-up work:

- WIT-defined Wasm tool capabilities;
- remote capability nodes for native execution;
- browser notifications and best-effort background work;
- selected HTTPS-only messaging channels;
- mobile and installable PWA support;
- richer compatibility-dashboard filtering over the implemented release and
  Gateway-contract history.

These features should not delay the compatibility harness or create a new
agent runtime inside Clawsembly.

## Immediate next tasks

Owner-authorized BrowserPod evidence capture is currently blocked by the
vendor runtime: BrowserPod 2.12.1 provisions Node 22.15.0, below the 22.19
baseline pinned by `openclaw@2026.6.11`, so the readiness probe fails closed
with `node_baseline_unsatisfied`; the vendor has been notified
([issue #6](https://github.com/haya-inc/clawsembly/issues/6)). Tasks 3 and 4
depend on a vendor Node upgrade or a revisited baseline decision.

1. Extend the versioned mock-state envelope to cover user workspaces and migration fixtures.
2. Execute the protected live smoke test with an owner-provided key, archive redacted evidence, and expand moderation UX.
3. Measure BrowserPod cold, warm, and persistent install paths and establish
   provider-specific latency/storage budgets.
4. Reproduce the full runtime slice on the selected commercial browser runtime.
5. Add remote-mode pairing approval, device-token rotation, revocation,
   recovery, and bridge-process hardening.

## Repositioning execution plan (ADR 0004, 2026-07-12)

ADR 0004 concluded that the release-tracking and evidence pipeline is
replicable and cannot be the moat; the durable value is browser-local execution
of upstream agents on BrowserPod plus an embedder-controlled, easily adjustable
host boundary — the default-deny capability broker, the evidence-bound embed
manifest, the permission-prompt UI, and payload-free audit. The evidence
pipeline is retained as supporting trust infrastructure: the evidence-gate
machinery is generic, and the OpenClaw reports are one instance of it.

Honesty constraints on every item below: today only OpenClaw is bound; no
owner-authorized runtime evidence exists yet, and every published report is
status `probing`; multi-upstream is a design commitment whose next concrete
step is the documented upstream-binding contract, not a shipped capability. No
resulting surface may state or imply that other agents already run.

Items are marked `owner` (requires the repository owner's accounts,
credentials, vendor relationship, or spending authority) or `contributor`
(implementable from a fork under the normal review process).

### Tranche 1: in the repository (2026-07-12)

All items in this tranche are `contributor`-scoped and land with the
repositioning change set:

- ADR 0004, the upstream-portable embedding boundary decision;
- README repositioned to the ADR 0004 framing, keeping the top section
  accessible to first-time readers;
- `docs/oss-strategy.md`, `docs/product.md`, and `docs/vision.md` aligned with
  the same framing;
- promotion-policy Action README pin fix: the usage example pins a non-default
  branch ref rather than a stable ref;
- DCO adoption for contributions;
- north-star latency instrumentation: reports record the upstream npm publish
  timestamp so upstream-publication-to-verified-report latency becomes
  measurable.

### Tranche 2: about 30 days

Owner actions (`owner`):

- capture owner-authorized BrowserPod runtime evidence (issue #6) and the
  missing performance baselines (issue #8); this also unblocks immediate next
  tasks 3 and 4 above;
- apply to the BrowserPod OSS grant program;
- file the two known upstream findings neutrally: the published stable
  shrinkwrap root declaration inconsistency and the preview Gateway-contract
  break;
- make one coordinated announcement only after runtime evidence lands: Show
  HN, the OpenClaw community, and a Japanese-language article;
- reserve a non-claw fallback name (an accepted risk in ADR 0004 is that the
  claw-family name now under-describes the scope);
- place a custom domain in front of the pinned report URLs so evidence links
  survive a hosting relocation.

Code (`contributor`):

- per-channel badge endpoints on Pages;
- a promotion-policy blocker/advisory split, so upstream-caused defects (for
  example `shrinkwrap-inconsistent`) become flagged advisories with a recorded
  waiver rationale instead of a permanent hold;
- a versioned schema-stability contract for the public JSON endpoints;
- a Japanese-language README.

### Tranche 3: about 90 days

- a documented upstream-binding contract — exact artifact identity, boot
  recipe, protocol client, capability requirements, and evidence gates — plus
  a minimal reference binding (a trivial hello-agent used only in tests) that
  proves the boundary is upstream-portable rather than a stated design
  property (`contributor`; shipped 2026-07-13 as
  [`packages/hello-agent-binding/`](../packages/hello-agent-binding/README.md)
  after the core artifact-identity checks were generalized from an `openclaw`
  literal to exact npm-name validation);
- an embedder-DX slice: a ten-line host integration, declarative capability
  configuration, and a pluggable permission UI (`contributor`);
- the compatibility dataset published as an npm data package and/or a Renovate
  datasource (`contributor`);
- a succession and sunset protocol: a second organization owner, key and
  BrowserPod-contract handover, and defined downstream behavior when reports
  stop refreshing (`owner`, with `contributor`-possible documentation);
- project-page messaging realigned with ADR 0004, tracked as its own item
  because the page carries browser-test text assertions that must move with it
  (`contributor`).
