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
The report preserves a name-sorted direct-dependency inventory with each exact
declared spec. Release tracking uses those inventories to generate added,
removed, and changed entries against stable without turning static drift into a
runtime PASS. Every added or changed dependency is then inspected from its
shrinkwrap-resolved, SHA-512-verified npm tarball with scripts disabled. The
release index records lifecycle scripts, native/Wasm artifacts, runtime Node
built-ins, network signals, derived browser capabilities, and whether the
bounded scan was complete.

The same artifact inspection reads the canonical public Gateway declaration
and runtime entry, its protocol constants, the unique generated server-methods
module, and legacy plugin declaration count. It never executes OpenClaw. The
release index publishes exact stable-relative method, schema, validator, event,
protocol, and distribution changes in `gatewayContractFromStable`; missing or
ambiguous source artifacts produce `incomplete` rather than an empty-compatible
result.

Release tracking also writes `promotion-policy.json`. It derives a `promote` or
`hold` candidate decision and independent stable/rollback eligibility from the
validated history. `compat:validate` recomputes the policy, so editing the
decision or its blockers without changing source reports fails CI. The public
schema and dependency-free consumer live under `apps/web/public/schemas/` and
`examples/release-policy/` respectively.

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
