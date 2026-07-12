# External SDK host example

This intentionally small Vite application consumes the packed
`@haya-inc/clawsembly` package through its public export map. It fetches the
published compatibility report, creates an exact evidence-bound manifest, and
shows why provider boot is allowed or blocked.

`src/report-pin.ts` pins the report's HTTPS URL, raw JSON SHA-256, exact
OpenClaw npm identity, and BrowserPod version. The host rejects an edited report
before `createEmbedManifest` can authorize launch. Updating the public report
therefore requires `npm run report-pin:generate` and an explicit review of the
generated pin diff. The scheduled tracker performs the generation in its
read-only job and carries the pin with the reports into the publishing PR.

The example contains no BrowserPod or OpenAI credential field and never boots a
provider automatically. With the current `probing` report it must display
`Provider boot blocked` and `Not attempted`.

## Run as an external starter

Copy this directory outside the Clawsembly checkout, then install the exact
GitHub prerelease pinned by `package-lock.json`:

```bash
npm ci
npm run dev
```

The lock records the Release URL and its SHA-512 integrity. The repository's
`sdk:check` independently rebuilds the source package and rejects the starter
lock if either the resolved URL or those exact bytes drift. This path does not
require npm registry publication.

## Run from a checkout

Build the local prerelease first, then install that tarball into this separate
package:

```bash
npm run sdk:pack
npm install --prefix examples/sdk-host --no-save --no-package-lock \
  ./.artifacts/sdk/haya-inc-clawsembly-0.1.0-alpha.0.tgz
npm run dev --prefix examples/sdk-host
```

The application imports `@haya-inc/clawsembly`; it does not use a Vite alias or
a relative path into the repository packages. The checked-in dependency uses
the exact GitHub prerelease; hosts may instead resolve the byte-identical Pages
tarball through `downloads/sdk-release.json`. After an npm prerelease exists,
the ordinary registry flow can use the declared version.

## Owner-controlled boot

A real host may import `bootVerifiedEmbed` and inject BrowserPod only inside an
explicit owner event handler after `assertVerifiedLaunch` succeeds. Keep the
BrowserPod API key in ephemeral host state, set an exact allowed browser origin,
and retain all capability prompts and audit export. This example deliberately
stops before that metered step while the public report is not supported.
