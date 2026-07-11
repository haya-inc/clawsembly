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
- stable / previous / preview release tracking with generated update pull
  requests and cross-version evidence rejection;
- report-driven project page, release ledger, compatibility badge, contribution
  templates, security policy, and downstream consumption guide.

### Known limitations

- status remains `partial` for `openclaw@2026.6.11`;
- the measured install/cache footprint is approximately 880 MB;
- an exact-marker Ed25519 verifier patch is still required;
- Firefox, Safari, remote Gateway parity, general workspace migration, and
  owner-authorized live-provider evidence remain unverified.
