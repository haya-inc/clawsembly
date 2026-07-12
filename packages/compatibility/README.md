# Compatibility inspector

The inspector turns an exact upstream npm artifact plus optional dated runtime
evidence into a machine-readable, reviewable compatibility report. Static
inspection never implies runtime support; each browser claim requires its own
checked-in evidence record.

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --runtime browserpod \
  --runtime-version 2.12.1 \
  --browser-baseline "Desktop Chromium" \
  --output apps/web/public/data/compatibility.json
```

The command downloads the exact npm tarball into an operating-system temporary
directory. It does not install the package or execute its lifecycle scripts.

Generate a static BrowserPod-target report without runtime evidence:

```bash
npm run compat:inspect -- \
  --package openclaw \
  --version 2026.6.11 \
  --runtime browserpod \
  --runtime-version 2.12.1 \
  --browser-baseline "Desktop Chromium" \
  --output /tmp/openclaw-browserpod.json
```

BrowserPod is the only accepted target and requires an exact `runtimeVersion`.
Provider-specific source evidence must be captured before any runtime check can
become green.

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

Every evidence reference includes a canonical SHA-256 digest. `compat:validate`
schema-checks raw BrowserPod records, verifies their digests, matches the
runtime, browser, OpenClaw version and integrity, and
recomputes all evidence-derived statuses.
