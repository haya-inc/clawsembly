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
- ordered embed-session close that refuses runtime disposal while the Gateway
  is active and retains cleanup access when cooperative stop fails;
- nonce-bound guest process supervisor for cooperative child shutdown without
  overstating BrowserPod process-termination or Pod-disposal capabilities;
- stable / previous / preview release tracking with generated update pull
  requests and cross-version evidence rejection;
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
- the measured install/cache footprint is approximately 880 MB;
- Firefox, Safari, remote Gateway parity, general workspace migration, and
  owner-authorized live-provider evidence remain unverified.
