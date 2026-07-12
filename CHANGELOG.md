# Changelog

All notable changes to Clawsembly will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project does not yet promise semantic-version compatibility.

## Unreleased

### Added

- exact-artifact OpenClaw compatibility inspection and versioned JSON schemas;
- Chromium WebContainer boot, Gateway handshake, constrained tool turn,
  reconnect, cancellation, and OPFS recovery probes;
- browser-host credential vault, device identity, provider broker, session
  budgets, and protected live-provider gate;
- BrowserPod adoption, a default-deny exact-scope capability broker, and an
  evidence-bound embed manifest that rejects cross-runtime support claims;
- documented-API BrowserPod lifecycle adapter for persistent Node 22 boot,
  long-running output readiness, portal discovery, and bounded file I/O;
- evidence-gated `bootVerifiedEmbed` that rejects unsupported or cross-runtime
  reports before BrowserPod token consumption;
- stable / previous / preview release tracking with generated update pull
  requests and cross-version evidence rejection;
- report-driven project page, release ledger, compatibility badge, contribution
  templates, security policy, and downstream consumption guide.

### Known limitations

- status remains `partial` for `openclaw@2026.6.11`;
- BrowserPod lifecycle and Gateway evidence are not yet captured, so verified
  BrowserPod launch remains intentionally blocked;
- BrowserPod 2.12.1 exposes no documented terminal-input, process-termination,
  or hard-disposal API, so complete Gateway cancellation and teardown remain blocked;
- the measured install/cache footprint is approximately 880 MB;
- an exact-marker Ed25519 verifier patch is still required;
- Firefox, Safari, remote Gateway parity, general workspace migration, and
  owner-authorized live-provider evidence remain unverified.
