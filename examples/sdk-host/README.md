# External SDK host example

This intentionally small Vite application consumes the packed
`@haya-inc/clawsembly` package through its public export map. It fetches the
published compatibility report, creates an exact evidence-bound manifest, and
shows why provider boot is allowed or blocked.

The example contains no BrowserPod or OpenAI credential field and never boots a
provider automatically. With the current `probing` report it must display
`Provider boot blocked` and `Not attempted`.

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
a relative path into the repository packages. After an npm prerelease exists,
the ordinary `npm install` flow will use the declared version instead.

## Owner-controlled boot

A real host may import `bootVerifiedEmbed` and inject BrowserPod only inside an
explicit owner event handler after `assertVerifiedLaunch` succeeds. Keep the
BrowserPod API key in ephemeral host state, set an exact allowed browser origin,
and retain all capability prompts and audit export. This example deliberately
stops before that metered step while the public report is not supported.
