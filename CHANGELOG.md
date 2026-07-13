# Changelog

All notable changes to Clawsembly will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project does not yet promise semantic-version compatibility.

## Unreleased

### Changed

- the `hello-agent` reference binding grows from a greeter into a minimal
  capability-consuming chat agent (fixture 0.1.0 → 0.2.0, protocol
  `clawsembly-hello/2`): `chat.send`, `chat.history`, and `chat.abort` join
  `hello.say`, with a validated delta/done event stream and in-flight abort.
  Every chat completion is delegated to the embedder-granted host capability
  `chat.complete` (scope `provider:reference`) through the staged,
  digest-pinned mailbox client, so the binding now demonstrates both growth
  paths of [ADR 0005](docs/decisions/0005-reference-agent-growth-paths.md):
  growing the first-party agent under exact-identity discipline, and
  extending the agent's abilities from outside through the default-deny
  boundary — deny, approve, revoke, and mid-turn cancellation are all
  exercised in provider-free tests. The hello-agent evidence gate now also
  requires a live capability transport, hello and chat round trips, and at
  least one denied plus one allowed boundary outcome. The fixture pins Node
  `>=22.12.0`, below the OpenClaw baseline, so the full verified chain stays
  capturable on the vendor's currently provisioned Node. No runtime-support
  claim is added; OpenClaw remains the only bound real upstream.

## [0.1.0-alpha.3] - 2026-07-13

### Changed (evidence baseline)

- the Node runtime baseline is no longer hard-coded to 22.19: the preflight,
  the readiness probe, and the capture harness now derive it from the target
  report's `artifact.nodeEngine` (only the exact `>=major.minor.patch` form
  is accepted; anything else fails closed as `node_baseline_unsupported`),
  captured evidence records the `nodeEngine` it proved, and the evidence
  schema plus `compat:validate` bind that recorded baseline to the report's
  artifact;
- the evidence capture target is selectable: `capture.mjs` honours
  `CLAWSEMBLY_EVIDENCE_REPORT` (contained to the public data directory) and
  the capture workflow exposes it as the `evidence_report` dispatch input,
  defaulting to the current stable report.

### Added (evidence baseline)

- a pinned static report for `openclaw@2026.5.7`
  (`apps/web/public/data/releases/openclaw-2026.5.7.json`), the newest
  upstream release whose `>=22.14.0` engines declaration the BrowserPod
  guest Node 22.15.0 satisfies, making an owner-authorized readiness capture
  possible before the vendor ships Node 22.19+. The report honestly records
  the version's limits: no npm-shrinkwrap (all direct dependencies
  unresolved, shrinkwrap check warns) and Gateway protocol 3 (`incomplete`
  contract inspection). `compat:validate` now validates every pinned report
  under `releases/`, not only the tracked channels;
- static inspection works on Windows checkouts: `compat:inspect` resolves
  the npm CLI through the invoking npm's JS entry point and passes tar a
  cwd-relative filename (GNU tar parses the colon in absolute Windows paths
  as a remote-host separator), and tolerates artifacts that predate
  npm-shrinkwrap adoption.

### Fixed

- the Gateway protocol client no longer routes frames that arrive after a
  failed handshake into authenticated handling: a rejected connect now
  detaches the socket, and event delivery additionally requires the ready
  state, so a refused Gateway cannot inject chat events into UI listeners;
- the guest mailbox client no longer burns a sequence slot when request
  validation, serialization, or the slot write fails before the ready marker:
  submissions serialize on an internal queue, the sequence advances only
  after announcement, and partially written slot files are released, so one
  rejected request can no longer desynchronize the channel permanently;
- a cooperative stop whose control-file write fails stays retryable instead
  of becoming a permanent no-op, and a supervisor that never reports
  readiness now receives a best-effort cooperative stop before the failure
  surfaces (`supervisor_ready_timeout`) instead of leaking an orphaned guest
  process;
- `gateway.stop()` during a failing start now resolves as not running
  instead of rethrowing the start error, and a successful pairing decision
  can no longer be re-armed into a second decision by a throwing
  `onDecision` sink.

### Added

- the `hello-agent` reference binding (`packages/hello-agent-binding/`): a
  trivial second upstream with an exact npm-shaped identity, a digest-verified
  staging recipe, dual deterministic readiness signals, a one-method protocol
  client pinned to the artifact's descriptor, an explicit empty
  capability-requirement declaration, and a minimal digest-bound evidence
  gate. Its tests execute the staged guest as a real Node child process
  behind a local provider double, without a metered runtime, proving the
  binding contract is satisfiable by something other than OpenClaw. The
  fixture is private, unpublished, and carries no runtime-support claim;
- an `oxlint` gate (`npm run lint`, exact-pinned, wired into `npm run
  check`) with correctness and suspicious categories enabled and the
  codebase's deliberate idioms documented in `.oxlintrc.json`;
- a security-header consistency check (`npm run headers:check`) pinning
  netlify.toml, vercel.json, the index.html CSP meta, and the Vite server
  headers to the Pages `_headers` declaration;
- unit tests for the release gate itself: the SDK release manifest binding
  (`packages/compatibility/src/release-binding.mjs`, extracted from
  release-readiness and now fixture-tested, including the rule that the
  npm publication record integrity must match the deployed bytes) plus
  execution-based tests that run the promotion-policy Action runner and the
  metered-capture harness on their fail-closed paths;
- a compile-only API conformance suite (`tests/types/`) that exercises the
  public `.d.mts` contracts against the shipped implementations, wired into
  `npm run typecheck`;
- CI hardening validated by `workflows:validate`: sdk-release tarball
  literals are cross-checked against the packaged version, every job carries
  an explicit `timeout-minutes`, the six-hour tracker verifies the generated
  Gateway contract against the exact npm artifact (`protocol:verify`) under
  a queued concurrency group, Pages deployments are never cancelled
  mid-flight, and the Windows lane also proves the Node 22.19 floor.

### Changed

- audit and diagnostic sinks are uniformly isolated: a throwing broker
  `auditSink` can no longer fail a request whose outcome is already
  recorded, and a capability handler that throws `CapabilityBrokerError`
  is now audited and redacted as `handler_failed` instead of passing a
  spoofed broker code through unrecorded;
- Gateway challenge nonces, connection tokens, and issued device tokens now
  reject the `|` payload delimiter and control characters before entering
  the signed v3 material, and stale or rewound Gateway event sequences are
  dropped with a payload-free audit record instead of rewinding the gap
  detector;
- the provider-broker self-probe reports the exact failed invariants by
  name instead of one opaque boolean, and individually closed protocol
  clients now leave the embed session's close set immediately;
- the core no longer hard-codes the `openclaw` package literal: the verified
  report loader, embed manifest, launch assertion, capability-broker subject,
  mailbox artifact, and permission-prompt subject now validate an exact
  npm-shaped package name (with the same version and SHA-512 exactness as
  before), and `bootVerifiedEmbed` explicitly rejects non-OpenClaw manifests
  as the OpenClaw binding boot path;
- BrowserPod persistent storage keys now include the upstream package name
  (`clawsembly:<package>:<version>:<workspace>`) so two upstreams at the same
  version cannot collide; existing persisted workspaces keyed under the old
  format start fresh.

## [0.1.0-alpha.2] - 2026-07-13

### Fixed

- the BrowserPod adapter now matches observed 2.12.1 runtime behavior:
  terminal output arrives as SharedArrayBuffer-backed `Uint8Array` views (the
  published type declares `ArrayBuffer`) and is copied before decoding, and
  the preflight and Gateway health probes are staged as guest files because
  the guest `node` resolves its first argument as a module path and
  implements no CLI flags;
- capture failures now surface a sanitized machine code (for example
  `missing_api_key` or `node_baseline_unsatisfied`) and the failed stage in
  the payload-free status artifact, including codes raised inside the
  evidence host page.

### Known limitations

- BrowserPod 2.12.1 provisions Node 22.15.0, below the 22.19+ baseline pinned
  by `openclaw@2026.6.11`; the readiness probe therefore fails closed with
  `node_baseline_unsatisfied` and every report remains `probing`. Reported to
  the runtime vendor.

## [0.1.0-alpha.1] - 2026-07-12

### Fixed

- Pages deployment now runs the complete Pages build before release-readiness,
  and required browser checks report on every pull request instead of blocking
  path-filtered contributor changes indefinitely.

### Added

- provenance-backed npm alpha publishing with GitHub Release byte comparison,
  idempotent registry-integrity checks, isolated bootstrap-token scope, and an
  OIDC trusted-publisher migration path;
- copy-ready external SDK host with a GitHub Release dependency, checked-in
  SHA-512 lock, and local reproducible-tarball drift enforcement;
- support and governance policies, a structured support-request template, and
  an explicit security-support table for the first source prerelease.

## [0.1.0-alpha.0] - 2026-07-12

### Added

- exact-artifact OpenClaw compatibility inspection and versioned JSON schemas;
- browser-host credential vault, device identity, provider broker, session
  budgets, and protected live-provider gate;
- BrowserPod adoption, a default-deny exact-scope capability broker, and an
  evidence-bound embed manifest that rejects cross-runtime support claims;
- documented-API BrowserPod lifecycle adapter for persistent Node 22 boot,
  long-running output readiness, portal discovery, and bounded file I/O;
- evidence-gated `bootVerifiedEmbed` that rejects unsupported or cross-runtime
  reports before BrowserPod token consumption;
- exact-artifact BrowserPod readiness harness and raw-evidence schema covering
  Node/crypto/SQLite preflight, npm SHA-512 matching, Gateway log/portal
  readiness, guest-local health/readiness probes, and cooperative Gateway stop;
- typed BrowserPod filesystem mailbox with exact-subject binding, strict
  bounded envelopes, replay defense, cancellation, and metadata-only audit;
- deterministic SHA-256-pinned guest transport artifact, automatic verified
  BrowserPod staging, explicit connection environment, and CI drift detection;
- headless capability-consent lifecycle with pending requests, bounded
  approval, deny, revoke, expiry, and schema-governed payload-free audit export;
- framework-neutral permission prompt with bounded grant controls, automatic
  expiry refresh, explicit audit download, and a provider-free public demo;
- shared exact-artifact OpenClaw installer for evidence probes and verified
  embed sessions, with concurrent-call aggregation, idempotence, bounded output,
  and installed manifest/package-lock integrity verification;
- shared verified Gateway controller with token-private supervised launch,
  portal/log plus guest-local health/readiness gates, explicit trusted-host
  connection material, failure cleanup, and cooperative stop;
- exact-artifact generated Gateway protocol 4 contract, strict browser-origin
  configuration, persistent non-extractable Ed25519 device identity,
  challenge-bound v3 connect signing, redacted `hello-ok` validation, and
  bounded pairing-required results;
- generated chat send/history/abort RPC allowlist with local-only delivery,
  bounded history/payloads/pending calls, validated stream events, sequence-gap
  reporting, disconnect rejection, and explicit signed reconnect;
- exact pending-device review through the pinned OpenClaw CLI, one-shot owner
  approve/reject controls, scope-drift refusal, and a framework-neutral pairing
  prompt;
- artifact/device/role/scope-bound AES-GCM device-token vault,
  token-authenticated signed reconnect, redacted metadata, and stale-token
  clearing;
- parity-tested ESM source entrypoint whose runtime boot exports match the
  public TypeScript declarations;
- byte-reproducible `@haya-inc/clawsembly@0.1.0-alpha.0` package assembly with
  a script-disabled isolated ESM/TypeScript consumer check and local checksum;
- BrowserPod-specific compatibility intake with an explicit evidence source,
  current probe stages, and mandatory secret-redaction confirmation;
- independent packed-SDK Vite/TypeScript host example and public launch
  inspector that renders exact blockers without provider traffic;
- branded compatibility-report loader that pins HTTPS source, raw JSON SHA-256,
  exact OpenClaw identity, and BrowserPod version before launch authorization;
- deterministic stable-report pin generation in the read-only release tracker,
  with path-safe artifact transfer into the isolated PR-publishing job;
- ordered embed-session close that refuses runtime disposal while the Gateway
  is active and retains cleanup access when cooperative stop fails;
- nonce-bound guest process supervisor for cooperative child shutdown without
  overstating BrowserPod process-termination or Pod-disposal capabilities;
- stable / previous / preview release tracking with generated update pull
  requests, exact direct-dependency manifest diffs, and cross-version evidence
  rejection;
- script-disabled exact-tarball risk classification for added and changed
  dependencies, covering lifecycle scripts, native/Wasm artifacts, Node
  built-ins, network APIs, scan completeness, and derived browser capabilities;
- non-executing exact-tarball Gateway contract inspection with stable-relative
  protocol, distribution, method, schema, validator, and event diffs plus
  fail-closed breaking/incomplete classification;
- project-page Gateway upgrade inspector exposing the preview classification,
  protocol movement, legacy declaration removal, and bounded exact-name lists;
- fail-closed promotion-policy artifact with independent stable, preview, and
  rollback gates, public schema URLs, and checked-in derivation validation;
- dependency-free strict-HTTPS Node/CI consumer and copyable GitHub Actions
  template for install-free external adoption;
- zero-install Node 24 GitHub Action with observe/gate modes and validated
  decision, candidate-version, and blocker outputs;
- manual Environment-protected BrowserPod evidence capture with exact isolated
  provider lock, cross-origin-isolated Chromium host, payload-free failure
  diagnostics, schema validation, and review-before-promotion runbook;
- Pages-distributed byte-reproducible SDK alpha, checksum, public release
  schema, and exact compatibility-report binding without an npm/support claim;
- tag-gated GitHub source prerelease automation with read/write job separation,
  exact transferred-asset allowlisting, browser diagnostics, checksum validation,
  and tag/source/Pages/report provenance;
- report-driven project page, release ledger, compatibility badge, contribution
  templates, security policy, and downstream consumption guide.

### Changed

- completed the BrowserPod-only cutover by removing the superseded runtime
  adapter, tests, dependencies, fixtures, public evidence, compatibility
  schemas, CLI flags, report branches, and vendor CSP allowance from main;
- switched compatibility inspection and release tracking defaults to
  `browserpod@2.12.1`, with all public runtime claims pending until matching
  owner-authorized evidence exists;

### Known limitations

- status remains `probing` for `openclaw@2026.6.11`;
- BrowserPod lifecycle and Gateway evidence are not yet captured, so verified
  BrowserPod launch remains intentionally blocked;
- BrowserPod 2.12.1 exposes no documented terminal-input, arbitrary
  process-termination, or hard-disposal API; Clawsembly can cooperatively stop
  its own supervised Gateway, but cannot claim provider-level teardown;
- BrowserPod install/cache/boot performance is not yet measured; the historical
  approximately 880 MB figure belongs to the removed runtime and is not a
  BrowserPod baseline;
- Firefox, Safari, remote Gateway parity, general workspace migration, and
  owner-authorized live-provider evidence remain unverified.

[0.1.0-alpha.3]: https://github.com/haya-inc/clawsembly/compare/v0.1.0-alpha.2...v0.1.0-alpha.3
[0.1.0-alpha.2]: https://github.com/haya-inc/clawsembly/compare/v0.1.0-alpha.1...v0.1.0-alpha.2
[0.1.0-alpha.1]: https://github.com/haya-inc/clawsembly/compare/v0.1.0-alpha.0...v0.1.0-alpha.1
