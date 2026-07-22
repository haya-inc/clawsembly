# `@haya-inc/clawsembly`

Evidence-gated browser embedding infrastructure for upstream OpenClaw.

This package is prepared as `0.1.0-alpha.4` for the npm `alpha` channel.
Publication follows the matching provenance-bound GitHub prerelease; consumers
can verify registry availability before preferring the npm install path.
The checked-in BrowserPod report remains `probing`, so verified boot correctly
fails before a provider key is consumed. A source tarball can still be built
and tested without making a runtime-support claim.

## Install the Pages-distributed source alpha

```bash
npm install https://haya-inc.github.io/clawsembly/downloads/haya-inc-clawsembly-0.1.0-alpha.4.tgz
```

The identical checked tarball is also attached to the
[GitHub source prerelease](https://github.com/haya-inc/clawsembly/releases/tag/v0.1.0-alpha.4):

```bash
npm install https://github.com/haya-inc/clawsembly/releases/download/v0.1.0-alpha.4/haya-inc-clawsembly-0.1.0-alpha.4.tgz
```

Verify the SHA-256 and compatibility binding through the public
[`sdk-release.json`](https://haya-inc.github.io/clawsembly/downloads/sdk-release.json).
Distribution does not change the public `probing` status or authorize
BrowserPod boot. The release-attached `source-release.json` additionally binds
those bytes to the Git tag and source commit.

## Install from npm after registry publication

```bash
npm install @haya-inc/clawsembly@alpha
```

BrowserPod is dependency-injected by the embedding host. This package does not
download or silently select a remote sandbox.

## Evidence-bound boot

```js
import {
  assertVerifiedLaunch,
  bootVerifiedEmbed,
  createEmbedManifest
} from "@haya-inc/clawsembly";
import { loadVerifiedCompatibilityReport } from "@haya-inc/clawsembly/report-loader";

const verifiedReport = await loadVerifiedCompatibilityReport({
  url: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
  sha256: pinnedReportSha256,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  artifact: pinnedOpenClawArtifact,
  target: { runtime: "browserpod", runtimeVersion: "2.12.1" }
});
const manifest = createEmbedManifest({ report: verifiedReport, capabilities });
assertVerifiedLaunch(manifest);

const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey: ownerSuppliedKey,
  gatewayOptions: { allowedOrigins: [globalThis.location.origin] }
});
```

The loader rejects redirects, non-HTTPS sources, byte drift, identity drift,
oversized or non-JSON responses, and internally inconsistent support claims.
A caller-created object with `status: "supported"` cannot authorize launch.
Additional narrow entrypoints are available for the explicit pairing prompt,
capability permission prompt, BrowserPod evidence probe, encrypted workspace
backup, capability broker, and remote-mode Gateway connection. The workspace
subpath exports a passphrase-encrypted exact-subject v2 envelope plus
explicit v1 migration; it does not silently reuse a disk or expose an
ambient backup UI.

The `remote-gateway` subpath is "connect your OpenClaw": it validates a
user-supplied Gateway endpoint (TLS required off-loopback) and opens the
same generated, version-locked client — persistent browser device identity,
encrypted device-token vault, bounded chat only — against a Gateway the
user already operates. It is interoperability, runs nothing
browser-locally, and never satisfies the browser-local acceptance gates.
An explicit `deviceManagement` opt-in additionally requests the generated
contract's `operator.pairing` scope and unlocks a bounded owner surface
for pairing review and device-token rotation, revocation, and removal —
the scope and the method list come from the generated contract, never
from the caller. There is no generic Gateway RPC export.

## Local artifact verification

From a Clawsembly checkout:

```bash
npm run sdk:check
npm run sdk:lock
npm run sdk:pack
```

`sdk:check` packs twice and requires byte-identical tarballs, installs one into
an isolated consumer, imports every public ESM subpath, and compiles a strict
TypeScript consumer against the packed declarations. It also installs the same
tarball into the repository's
[external host example](https://github.com/haya-inc/clawsembly/tree/main/examples/sdk-host)
and builds that application without a workspace alias. `sdk:pack` writes the
verified prerelease tarball under the ignored `.artifacts/sdk/` directory.
Use `sdk:lock` only during an intentional version bump; it updates the starter's
future GitHub Release URL and SHA-512 from the newly packed bytes.

The project remains unofficial and is not affiliated with the OpenClaw project.
