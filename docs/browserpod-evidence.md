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
   from guest-local `/healthz` and `/readyz` probes.

The returned evidence contains no BrowserPod API key or Gateway token. It does
record that the portal is a public URL and that BrowserPod 2.12.1 has no
documented terminal-input, provider-process-termination, or hard-disposal API.

This is a readiness boundary, not full support. A successful record promotes
the BrowserPod preflight and OpenClaw boot checks only. Gateway `hello-ok`, the
broker turn, tool execution, reconnect, cancellation, persistence, and
performance-distribution checks remain pending.

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
metered. Because the documented provider API cannot terminate the foreground
Gateway or dispose the Pod, `session.dispose()` is deliberately logical-only
and returns the still-active task IDs. Close the owner-controlled probe context
according to the provider's documented lifecycle and do not claim cleanup from
the returned value.

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
