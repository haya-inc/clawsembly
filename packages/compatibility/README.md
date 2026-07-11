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

`--host-evidence` attaches a dated, reviewable WebContainer preflight. It may
mark the browser host as verified, but it never changes the separate OpenClaw
boot, Gateway handshake, or chat checks.

`--gateway-evidence` independently promotes boot, authenticated WebSocket
handshake, streamed chat, constrained tool, reconnect history, and cancellation
checks only when their matching evidence fields pass. A health check by itself
never implies that later protocol stages passed.

Every evidence reference includes a canonical SHA-256 digest. `compat:validate`
schema-checks the raw host and Gateway records, verifies those digests, matches
the embedded OpenClaw version, and recomputes all evidence-derived statuses.
