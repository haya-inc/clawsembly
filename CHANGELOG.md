# Changelog

All notable changes to Clawsembly will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project does not yet promise semantic-version compatibility.

## Unreleased

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
- copy-ready external SDK host with a GitHub Release dependency, checked-in
  SHA-512 lock, and local reproducible-tarball drift enforcement;
- support and governance policies, a structured support-request template, and
  an explicit security-support table for the first source prerelease;
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
