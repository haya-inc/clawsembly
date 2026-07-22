# Native-Gateway evidence capture

This host captures the first wrap deliverable of
[ADR 0006](../../docs/decisions/0006-openclaw-specialist-refocus.md): it
installs the exact pinned `openclaw` artifact on plain Node, boots the real
Gateway on loopback, waits for the `[gateway] ready` line, probes
`/healthz` and `/readyz` from the host, stops the process by signal, and
writes one digest-bound record of the **`native-gateway` evidence class**.

Honesty boundary: this class is deliberately disjoint from BrowserPod
runtime evidence. The record names `runtime: "native-node"` with
`browserLocal: false`, is admitted only by `assertNativeGatewayEvidence`,
and never enters the compatibility reports, the promotion policy, or the
verified-launch gates. A passing native capture proves the artifact boots
and answers health checks on a plain Node host — nothing more.

## Requirements

- A local Node version that satisfies the pinned artifact's published
  compound engines range (evaluated fail-closed before anything runs; at
  `openclaw@2026.7.1-2` that is `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`).
- Network access to the public npm registry. The install runs the real
  dependency tree of the upstream artifact in a temporary directory that is
  removed afterwards.
- No BrowserPod key, no provider credential, no metered spend.

## Run it

```bash
npm run native:capture
```

Running through the npm script matters on Windows: the runtime resolves npm
through `npm_execpath` and fails closed when it cannot.

Outputs land under `test-results/native-gateway-evidence/`:

- `native-gateway-openclaw-<version>.json` — the digest-bound evidence
  record (statuses, durations, and identity only; no transcripts, bodies,
  environment values, or host paths);
- `capture-status.json` — a payload-free status for CI artifact review.

`CLAWSEMBLY_EVIDENCE_REPORT` selects a different pinned report (it must live
under `apps/web/public/data`), and `CLAWSEMBLY_NATIVE_GATEWAY_PORT`
overrides the loopback port. In CI the opt-in `native-gateway-evidence` job
in `.github/workflows/runtime-browser.yml` runs the same capture on a plain
Node 24 runner and uploads both files for review; nothing is committed or
promoted automatically.
