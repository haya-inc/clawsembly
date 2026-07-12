# Upstream compatibility strategy

## Why automation is mandatory

At the 2026-07-12 survey point:

- the latest stable npm release was OpenClaw `2026.6.11`;
- the upstream main package declared `2026.7.2`;
- 46 stable versions had been published after the version pinned by ClawLess,
  `2026.3.13`.

OpenClaw changes too frequently for a manually maintained browser fork or
feature-parity checklist to remain current.

## Compatibility boundary

Clawsembly should depend on three upstream surfaces, in descending order of
preference:

1. documented Gateway WebSocket and HTTP contracts;
2. the published `openclaw` npm artifact;
3. generated schemas and source metadata from a matching OpenClaw tag.

The upstream Gateway protocol and client workspaces are currently private npm
packages. OpenClaw's external-app guidance recommends using the documented
Gateway protocol, pinning the tested OpenClaw version, and reviewing the RPC
contract when upgrading. Clawsembly should therefore generate its browser
client at build time rather than importing those private packages.

References:

- [Gateway integrations for external apps](https://docs.openclaw.ai/concepts/openclaw-sdk)
- [Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [TypeBox schema generation](https://docs.openclaw.ai/concepts/typebox)

## Versioned compatibility manifest

Each supported release range should resolve to a machine-readable manifest.
An illustrative shape is:

```json
{
  "schemaVersion": 1,
  "openclaw": ">=2026.6.11 <2026.7.0",
  "protocol": {
    "min": 4,
    "max": 4
  },
  "disabledCapabilities": [
    "bonjour",
    "host-browser",
    "native-pty",
    "voice"
  ],
  "dependencyOverrides": {
    "@lydell/node-pty": "@clawsembly/stub-node-pty"
  },
  "sourcePatches": [
    {
      "id": "ed25519-noble-verify",
      "scope": "exact OpenClaw verifier module markers",
      "failureMode": "abort on upstream drift"
    }
  ]
}
```

The real schema must distinguish eager boot blockers from optional feature
dependencies and explain why each capability is disabled.

## Update automation

An updater workflow should run against every new stable release and optionally
against the latest beta as an early warning.

The implemented tracker resolves `stable`, `previous`, and `preview` from npm,
generates a report for each exact artifact, and writes a release-history index.
Each report preserves a sorted exact direct-dependency inventory from its
packed manifest. The index recomputes added, removed, and changed specs against
stable, so preview drift is reviewable without inferring support from a count.
For every added or changed entry, the tracker downloads the exact
shrinkwrap-resolved tarball with scripts disabled, verifies its SHA-512, and
performs a bounded static risk scan. It records lifecycle scripts, native and
Wasm artifacts, runtime Node built-ins, network signals, and derived browser
capabilities together with scan completeness.
Checked-in Gateway evidence is attached to whichever channel has the exact same
OpenClaw version; the report builder rejects mismatched runtime evidence. The
scheduled workflow exits without rewriting timestamps when channel versions are
unchanged and proposes generated changes through a fixed automation branch.
That pull request triggers the browser lane, which installs the version named by
the generated stable report and retains a versioned, allowlisted evidence JSON;
it does not reuse the previous version's pass state.

```mermaid
flowchart LR
    Release["New OpenClaw release"]
    Inspect["Inspect artifact and schemas"]
    Diff["Classify dependency and protocol diff"]
    Boot["Boot in BrowserPod"]
    Smoke["Run browser smoke tests"]
    Report["Compatibility report"]
    PR["Automated upgrade PR"]

    Release --> Inspect --> Diff --> Boot --> Smoke --> Report --> PR
```

### Static checks

- Diff direct dependency names and exact specs, then classify exact-tarball
  lifecycle, native/Wasm, Node built-in, network, and browser-capability signals
  automatically. Optional and transitive ownership still requires review.
- Compare the published manifest with the shrinkwrap root; report missing or
  mismatched declarations that make deterministic `npm ci` impossible.
- Identify native addons, install scripts, and Node built-in imports.
- Generate and diff Gateway JSON Schema and protocol constants.
- Diff advertised methods and events.
- Validate the compatibility-manifest schema.

### Runtime checks

- Install the exact npm artifact in a fresh BrowserPod channel.
- Start a minimal Gateway configuration.
- Verify `/healthz`, `/readyz`, and the Gateway handshake.
- Complete a provider-independent mocked chat turn.
- Complete a live-provider smoke test only in protected CI.
- Exercise workspace read/write and persistence.
- Verify that every disabled capability fails with its documented error.
- Capture startup logs, dependency inventory, browser console output, and a
  machine-readable capability report.

## Change classification

| Change | Expected response |
| --- | --- |
| Additive protocol field or event | Regenerate client; preserve unknown data |
| Protocol-version bump | Add dual-version fixtures and review handshake |
| New optional native dependency | Disable only the owning capability |
| New eager native dependency | Add a host/Wasm adapter or block upgrade |
| Config schema change | Regenerate minimal config and migration fixture |
| BrowserPod provider regression | Keep the last evidenced artifact/provider pair; report to the vendor |
| Source patch required | Link it to an upstream issue or PR |

## Support policy

- `stable`: latest verified OpenClaw stable release.
- `previous`: previous verified stable release for rollback.
- `preview`: latest beta, allowed to fail and used for early warnings.
- `unsupported`: releases that cannot boot safely; include a diagnostic reason.

Clawsembly should never silently install an unverified `latest` version.
Users may opt into preview versions, but the UI must show their compatibility
status before boot.

## Maintenance budget

The target steady state is:

- no handwritten change for additive protocol releases;
- manifest-only changes for optional unsupported dependencies;
- small host-adapter changes for newly supported capabilities;
- rare source patches, each linked to an upstream report;
- an upgrade report generated without access to production secrets.
