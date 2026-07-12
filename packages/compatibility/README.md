# Compatibility inspector

The inspector turns an exact upstream npm artifact plus optional dated runtime
evidence into a machine-readable, reviewable compatibility report. Static
inspection never implies runtime support; each browser claim requires its own
checked-in evidence record.

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --host-evidence apps/web/public/data/evidence/webcontainer-host.json \
  --gateway-evidence apps/web/public/data/evidence/openclaw-2026.6.11-gateway.json \
  --output apps/web/public/data/compatibility.json
```

The command downloads the exact npm tarball into an operating-system temporary
directory. It does not install the package or execute its lifecycle scripts.

Generate a static BrowserPod-target report without attaching legacy evidence:

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --runtime browserpod \
  --runtime-version 2.12.1 \
  --browser-baseline "Desktop Chromium" \
  --output /tmp/openclaw-browserpod.json
```

BrowserPod targets require an exact `runtimeVersion`. The generator rejects
WebContainer host or Gateway evidence on that target; provider-specific source
evidence must be captured before any runtime check can become green.

Attach a reviewed BrowserPod readiness record:

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --runtime browserpod \
  --runtime-version 2.12.1 \
  --browser-baseline "<exact browser string from evidence>" \
  --browserpod-evidence apps/web/public/data/evidence/browserpod-openclaw-2026.6.11.json \
  --output apps/web/public/data/compatibility.json
```

The BrowserPod evidence schema requires exact artifact integrity, Node
preflight, Gateway log readiness, HTTPS portal discovery, and HTTP 200 from
both `/healthz` and `/readyz`. Attaching it promotes only the preflight and boot
checks; protocol, broker, tool, recovery, and teardown claims remain separate.

`--host-evidence` attaches a dated, reviewable WebContainer preflight. It may
mark the browser host as verified, but it never changes the separate OpenClaw
boot, Gateway handshake, or chat checks.

`--gateway-evidence` independently promotes boot, authenticated WebSocket
handshake, streamed chat, constrained tool, reconnect history, and cancellation
checks only when their matching evidence fields pass. A health check by itself
never implies that later protocol stages passed.

Every evidence reference includes a canonical SHA-256 digest. `compat:validate`
schema-checks the raw host, Gateway, and BrowserPod records, verifies those
digests, matches the runtime, browser, OpenClaw version and integrity, and
recomputes all evidence-derived statuses.
