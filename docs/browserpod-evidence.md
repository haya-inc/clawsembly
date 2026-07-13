# BrowserPod evidence workflow

Clawsembly keeps BrowserPod adoption separate from BrowserPod support. The
provider becomes partially evidenced only when a reviewed record proves the
same exact OpenClaw artifact inside the selected runtime and browser.

## What the readiness probe proves

`runBrowserPodOpenClawProbe` uses one owner-authorized, metered BrowserPod to:

1. boot BrowserPod 2.12.1 with Node 22;
2. verify Node 22.19+, `node:crypto`, and `node:sqlite` in the guest;
3. install `openclaw@<exact-version>` without skipping lifecycle scripts;
4. compare the installed manifest and `package-lock.json` integrity with the
   inspected npm SHA-512;
5. start the real Gateway on an authenticated loopback port;
6. require the `[gateway] ready` log, an HTTPS BrowserPod portal, and HTTP 200
   from guest-local `/healthz` and `/readyz` probes;
7. stop that Gateway through a nonce-bound guest supervisor and require its
   foreground task to finish.

The returned evidence contains no BrowserPod API key or Gateway token. It does
record that the portal is a public URL. It also distinguishes the successful
cooperative Gateway stop from BrowserPod 2.12.1's still-unavailable documented
terminal-input, provider-process-termination, and hard-disposal APIs.

This is a readiness boundary, not full support. A successful record promotes
the BrowserPod preflight and OpenClaw boot checks only. Clawsembly now has a
provider-free, exact-artifact contract test for challenge signing and
`hello-ok`, but no owner-authorized BrowserPod record has exercised that client.
The real Gateway handshake, broker turn, tool execution, reconnect,
cancellation, persistence, and performance-distribution checks remain pending.
Provider-free tests now also cover the bounded chat send/history/abort contract,
stream event delivery, sequence gaps, disconnect rejection, and a fresh signed
reconnect. None of those tests substitute for a metered BrowserPod record.
They also cover exact pending-device review, refusal of changed or broader
requests, one-shot approve/reject, encrypted issued-token persistence,
device-token signed reconnect, and stale-token clearing. Runtime evidence must
still capture those same steps against the real BrowserPod portal before the
device-identity compatibility check can pass.

## Capture from an embedding host

The provider module and credential stay under the embedding host's control:

```js
import { BrowserPod } from "@leaningtech/browserpod";
import { runBrowserPodOpenClawProbe } from "./packages/browser-runtime/browserpod-openclaw-probe.mjs";

const session = await runBrowserPodOpenClawProbe({
  BrowserPod,
  apiKey: ownerSuppliedBrowserPodKey,
  artifact: {
    package: "openclaw",
    version: inspectedReport.artifact.version,
    integrity: inspectedReport.artifact.integrity
  },
  browser: navigator.userAgent,
  storageKey: `clawsembly-evidence-${inspectedReport.artifact.version}`,
  onOutput({ phase, chunk }) {
    renderRedactedDiagnostic(phase, chunk);
  }
});

const evidenceJson = JSON.stringify(session.evidence, null, 2);
```

Run this only with explicit owner consent. BrowserPod boot and execution are
metered. The probe stops its own Gateway through the guest supervisor before it
returns, so the foreground task is complete. `session.dispose()` remains a
logical-only Pod close because BrowserPod exposes no documented hard-disposal
operation. Close the owner-controlled probe context according to the provider's
documented lifecycle and do not claim Pod cleanup from the returned value.

## Capture through GitHub Actions

The repository includes a dedicated manual capture job in
`Browser host, page, and evidence`. It never runs on pull requests or the
schedule. Before the first run, a maintainer must:

1. create the repository Environment `browserpod-evidence`;
2. add required reviewers so a dispatch cannot spend tokens without an owner
   approval;
3. store the BrowserPod credential as the Environment secret
   `BROWSERPOD_API_KEY`;
4. confirm the selected branch contains the exact report and capture harness to
   review;
5. dispatch the workflow with `capture_browserpod` enabled.

Warning: a metered capture against `browserpod@2.12.1` currently fails closed
with `node_baseline_unsatisfied` — the guest provisions Node 22.15.0, below
the required 22.19 baseline — before any promotable evidence exists. Do not
spend BrowserPod tokens until the vendor ships Node 22.19 or newer, or the
baseline decision is revisited
([issue #6](https://github.com/haya-inc/clawsembly/issues/6)).

The job installs `@leaningtech/browserpod@2.12.1` from its isolated lock with
scripts disabled, launches a cross-origin-isolated Chromium host, and passes the
secret directly into one page evaluation. The key is never written to source,
DOM, console capture, evidence, status, or uploaded paths. Diagnostic callbacks
retain only per-phase chunk and byte counts.

BrowserPod documents that `boot` requires an API key and consumes tokens. One
dispatch is therefore an owner-authorized metered operation. The workflow
uploads either a schema-valid raw evidence record plus payload-free status, or
only a payload-free failure status. It does not commit or promote the result.

After downloading `browserpod-evidence-<run-id>`, review the JSON and copy the
approved record to the versioned evidence path. Then regenerate all channel
artifacts together so the stable report, SDK pin, release policy, and page stay
coherent:

```bash
evidence=apps/web/public/data/evidence/browserpod-openclaw-2026.6.11.json
browser=$(node -p "JSON.parse(require('fs').readFileSync('$evidence')).target.browser")

npm run compat:track -- \
  --browserpod-evidence "$evidence" \
  --browser-baseline "$browser"
npm run report-pin:generate
npm run compat:validate
npm run release:check
```

Promotion remains a reviewed commit. A successful readiness record promotes
only the preflight and Gateway-boot checks represented by its schema.

## Attach reviewed evidence

Validate the raw record against
`packages/compatibility/browserpod-evidence.schema.json`, then place the
reviewed file at:

```text
apps/web/public/data/evidence/browserpod-openclaw-<version>.json
```

Generate the matching report:

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

The generator rejects runtime-version, browser, package, OpenClaw-version, or
integrity mismatches. `compat:validate` then schema-checks the raw evidence,
verifies its canonical SHA-256 digest, and recomputes every evidence-derived
status.

## Provider boundaries

BrowserPod's documented [`boot`](https://browserpod.io/docs/reference/BrowserPod/boot)
and [`run`](https://browserpod.io/docs/reference/BrowserPod/run) APIs are the
only process entry points used. Portal URLs follow the provider's
[portal model](https://browserpod.io/docs/guides/setup-portal) and are treated
as public metadata, never as a private loopback boundary. Commercial use still
requires the appropriate [BrowserPod license](https://browserpod.io/docs/more/licensing).
