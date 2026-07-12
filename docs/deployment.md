# Project page deployment

The report-driven project page is a static Vite build. It does not boot a guest
runtime: BrowserPod starts only from an embedding host that supplies its own API
key after `assertVerifiedLaunch` passes. The public page has no WebContainer or
StackBlitz code, fallback, frame, network permission, or production dependency.

## Security headers

The checked-in deployment configurations enforce:

- HTTPS hosting;
- `Cross-Origin-Opener-Policy: same-origin`;
- `Cross-Origin-Embedder-Policy: credentialless`;
- a restrictive Content Security Policy;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- MIME sniffing protection and a minimal Permissions Policy.

The CSP permits same-origin scripts, the hashed JSON-LD block, Google Fonts,
same-origin data, and the fixed OpenAI Responses destination used only by the
explicit protected live-test gate. It permits no third-party frame and no
BrowserPod vendor origin because this page does not load the provider. An
embedding host must review and add the exact pinned BrowserPod delivery origin
it uses.

## Supported deployment configs

- GitHub Pages publishes `dist` from the `gh-pages` branch.
- `npm run build:pages` also builds the packed-SDK host under
  `dist/sdk-host/`; that application consumes the generated tarball and must
  remain provider-free while the public report is `probing`.
- The same build publishes the byte-reproducible SDK tarball, checksum, and
  report-bound release manifest under `dist/downloads/`. This is a source-alpha
  distribution channel, not an npm publication or runtime-support claim.
- A matching prerelease tag runs `.github/workflows/sdk-release.yml`. Its
  read-only job repeats the full release check and transfers an exact asset set
  to a separate write-capable job that executes no npm code. GitHub Release
  assets include the same tarball, checksum, report corpus, browser diagnostics,
  and source/tag/Pages provenance.
- Publishing that GitHub prerelease triggers the npm workflow. It publishes
  only the byte-identical verified tarball under the `alpha` dist-tag, with
  provenance and an idempotent registry-integrity check. npm credentials never
  enter build, browser-test, artifact-comparison, or GitHub Release jobs.
- Cloudflare Pages reads `apps/web/public/_headers`.
- Netlify uses `netlify.toml`.
- Vercel uses `vercel.json`.

Run `npm run build` for an origin-root deployment or `npm run build:pages` for
the `/clawsembly/` GitHub Pages base path.

## Verification

After deployment:

1. require HTTP 200 over HTTPS;
2. confirm the compatibility target is `browserpod@2.12.1`;
3. confirm no public report attaches legacy provider evidence;
4. confirm the document and response CSP contain no `stackblitz.com`;
5. run the provider-free browser-host vault, identity, budget, and consent tests;
6. confirm no BrowserPod or OpenAI request occurs without explicit owner action.

The optional live smoke test requires browser CORS access to
`https://api.openai.com/v1/responses`. Reachability does not prove an
authenticated request, and no owner-authorized live request is checked in.
