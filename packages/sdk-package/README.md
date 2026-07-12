# `@haya-inc/clawsembly`

Evidence-gated browser embedding infrastructure for upstream OpenClaw.

This package is prepared as `0.1.0-alpha.0`, but is not published to npm yet.
The checked-in BrowserPod report remains `probing`, so verified boot correctly
fails before a provider key is consumed. A source tarball can still be built
and tested without making a runtime-support claim.

## Install after a prerelease is published

```bash
npm install @haya-inc/clawsembly@0.1.0-alpha.0
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

const manifest = createEmbedManifest({ report, capabilities });
assertVerifiedLaunch(manifest);

const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey: ownerSuppliedKey,
  gatewayOptions: { allowedOrigins: [globalThis.location.origin] }
});
```

Additional narrow entrypoints are available for the explicit pairing prompt,
capability permission prompt, BrowserPod evidence probe, and capability broker.
There is no generic Gateway RPC export.

## Local artifact verification

From a Clawsembly checkout:

```bash
npm run sdk:check
npm run sdk:pack
```

`sdk:check` packs twice and requires byte-identical tarballs, installs one into
an isolated consumer, imports every public ESM subpath, and compiles a strict
TypeScript consumer against the packed declarations. It also installs the same
tarball into the repository's
[external host example](https://github.com/haya-inc/clawsembly/tree/main/examples/sdk-host)
and builds that application without a workspace alias. `sdk:pack` writes the
verified prerelease tarball under the ignored `.artifacts/sdk/` directory.

The project remains unofficial and is not affiliated with the OpenClaw project.
