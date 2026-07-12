# Initial roadmap

The roadmap prioritizes evidence about upstream compatibility before product UI
or a broad feature set.

## Phase 0: feasibility gate and compatibility lab

Deliverables:

- project documentation and contribution baseline;
- a checked-in compatibility-report schema and static artifact inspector;
- a report-driven public project page;
- browser-local commercial-runtime decision;
- actual WebContainer Node-version capture;
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

Status: the pinned release boots with one fail-closed exact-marker patch for
Ed25519 verification. The patch preserves rejection of invalid signatures and
is listed in the checked-in compatibility evidence; upstream reporting remains.

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

Status: partial. Browser-owned Ed25519 identity now signs a real v3 challenge
and receives `hello-ok`. The local standard Control UI path pairs, issues a
device token, persists it encrypted in the browser host, and reconnects with
token authentication after the shared-token session. Streamed chat,
cancellation, history, and reconnect pass for the embedded probe. Generated UI
client work, remote-mode parity, remote approval, rotation, revocation, and
recovery remain.

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
to WebContainer. Typed text deltas reach OpenClaw, a streamed `agents_list`
function call is translated and executed, and its matched result is serialized
as Responses `function_call` / `function_call_output` input for the second
provider request. `chat.abort` cancels the browser request and provider stream.
User-configurable request/input/output budgets are enforced and reported by the
browser host. A fixed-prompt live smoke-test UI is credential- and consent-gated,
cost-bounded, cancellable, and complete-output-only; automation proves the gate
without making a live request. User-workspace migration fixtures, the first
owner-authorized live execution and broader moderation UX remain. The first
default-deny capability broker now enforces exact artifact subjects, scopes,
call limits, expiry, revocation, cancellation, and payload-free audit; user
permission prompts and guest transport integration remain.

The Chromium performance lane now measures a 57.1-second cold install, including
49.7 seconds for the 293-package nested repair, a 2.9-second warm reinstall,
618.5 MB of `node_modules`, 261.6 MB of npm cache, and 16.4 seconds to Gateway
protocol readiness. Suppressing redundant repair scripts improved cold time by
4.1%. A deterministic `npm ci` experiment was rejected because the published
shrinkwrap root omits 31 manifest dev-dependency declarations. The static
inspector now detects root declaration drift on every inspected release.
Footprint and cold-path reduction remain Phase 3 work.

### Phase 3b: BrowserPod runtime integration

Replace the WebContainer-specific production boundary without moving execution
to a server:

- keep the current WebContainer lane as regression evidence;
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
HTTPS portal discovery, and bounded file I/O. The public 2.12.1 API exposes no
terminal input, process termination, or hard disposal, leaving cancellation
and teardown blocked pending a documented provider mechanism.

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
`bootVerifiedEmbed` are implemented. The current WebContainer `partial` report
is correctly rejected before BrowserPod boot or token consumption. The boot
slice is not promoted as supported while provider lifecycle evidence and
termination remain missing.

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
skips unchanged channels. The six-hour workflow uploads all reports and opens
or refreshes a fixed-branch pull request when a channel moves. Full runtime
execution on that pull request derives the version from the generated stable
report and retains a redacted, versioned evidence artifact on success. Promotion
of that CI artifact into the durable checked-in report, schema/protocol diff
generation, and automatic rollback promotion remain.

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
3. Replace or cache the 293-package repair path and reduce the measured 880 MB combined install/cache footprint.
4. Reproduce the full runtime slice on the selected commercial browser runtime.
5. Add remote pairing approval, device-token rotation, revocation, recovery, and bridge-process hardening.
