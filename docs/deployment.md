# Project page deployment

The report-driven project page is a static Vite build, but its interactive
WebContainer probe has stricter hosting requirements than an ordinary static
site.

## Required response headers

Serve every page over HTTPS with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

The probe boots WebContainer with `coep: "credentialless"`, so the document
header and boot option must stay aligned. The runtime preflight fails closed
when `window.crossOriginIsolated` or `SharedArrayBuffer` is unavailable.

## Supported deployment configs

- Cloudflare Pages reads `apps/web/public/_headers`, which Vite copies to the
  root of `dist`.
- Netlify uses the checked-in `netlify.toml`.
- Vercel uses the checked-in `vercel.json`.

For all three providers, use `npm run build` and publish `dist`.

## GitHub Pages limitation

The GitHub Pages workflow publishes the project narrative and checked-in
compatibility report at `/clawsembly/`. GitHub Pages does not provide repository
configuration for these response headers, so the interactive runtime preflight
will show `Host is not isolated`. Use one of the header-capable deployments for
the live demo; do not mask this failure or claim that the Pages host ran the
probe.

## Verification

After deployment, verify the document response headers and run the page's host
preflight. A valid runtime host reports:

- `crossOriginIsolated: true`;
- `SharedArrayBuffer: available`;
- a successful WebContainer boot;
- the actual embedded Node version.

The optional live smoke test also requires browser CORS access to
`https://api.openai.com/v1/responses`. An unauthenticated preflight captured on
2026-07-12 returned HTTP 200 and allowed `POST`, `authorization`, and
`content-type` for the GitHub Pages origin. This proves browser reachability,
not an authenticated model request; deployments should recheck the preflight
before enabling live-test UI.
