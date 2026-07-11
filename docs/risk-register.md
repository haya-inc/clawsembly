# Risk register

| Risk | Current evidence | Decision or mitigation | Gate |
| --- | --- | --- | --- |
| WebContainer production licensing | Commercial for-profit production usage may require a license | Confirm the intended hosted-product model with StackBlitz before promising a operated service | Before public hosted beta |
| Hosted runtime dependency | The WebContainer engine is hosted separately from the npm client | Document availability, privacy, caching, and fallback expectations; do not claim fully self-contained operation | Phase 0 |
| Node runtime mismatch | WebContainer provides Node 22.22.3, satisfying OpenClaw's >=22.19.0 requirement; one nested dependency warns that it prefers Node >=24 | Keep the warning visible and exercise the code path before upgrading the browser baseline | Continuous |
| Artifact weight | After a 4.1% script-suppression improvement, Chromium measures 57.1 s cold install, 2.9 s warm reinstall, 618.5 MB `node_modules`, and 261.6 MB npm cache; the nested repair alone takes 49.7 s, while `npm ci` rejects 31 manifest dev dependencies missing from the shrinkwrap root | Keep the automated root-consistency warning, report the shrinkwrap defect upstream, cache or replace the 293-package repair path, and set regression budgets before beta | Phase 1 |
| Native dependencies | node-pty and sqlite-vec platform variants are present | Classify eager versus optional imports and disable only the owning capability | Phase 1 |
| Node builtin drift | WebContainer `fs.readSync` rejects the Node-compatible bigint position used by OpenClaw JSONL appends | Keep the safe-integer position adapter narrow and covered by the end-to-end tool loop | Continuous |
| Device identity extraction | A non-extractable browser Ed25519 key completes local Control UI pairing; the issued token is encrypted in IndexedDB and performs a token-only reconnect, while existing briefly in a dedicated bridge process | Keep the private key browser-only and the bridge ephemeral; add remote approval, rotation, revocation, recovery, and bridge hardening before user-facing auth | Before user-facing auth |
| OpenClaw source patch drift | 2026.6.11 needs an exact-marker Noble fallback because WebContainer `node:crypto` cannot construct the verifier key | Fail closed on marker drift, test invalid signatures, publish the patch in compatibility evidence, and pursue an upstream fix | Every OpenClaw upgrade |
| Provider-secret exposure | An OpenClaw agent completes a turn through the browser-host broker without receiving the API key; the live smoke-test gate requires explicit consent, but same-origin script injection could still invoke the stored key | Keep provider calls destination/model allowlisted with user-configurable request/input/output budgets, fixed live probe content, token caps, and explicit opt-in; enforce strict content delivery and dependency review | Before live provider testing |
| Browser data loss | OPFS mock-state recovery and explicit binary export/import pass, but quota eviction or origin changes can still remove state | Add a versioned manifest, recovery UX, and encrypted user-workspace backups before production-ready status | Phase 3 |
| Browser support overclaim | Firefox and Safari WebContainer behavior differs from Chromium | Support desktop Chromium first and publish a browser matrix based on test artifacts | Before 0.2 |
| Cross-version evidence reuse | A new dist-tag could otherwise appear verified using an older release's Gateway artifact | Match the embedded OpenClaw version before attachment and make the report builder reject all mismatches | Every generated report |
| Upstream velocity | Stable releases are frequent | Start automated static inspection in Phase 0 and runtime inspection in Phase 1 | Continuous |
| Product sprawl | Embedded, remote, persistence, WIT, and channels compete for focus | Compatibility lab first; one-turn demo second; defer ecosystem features | Every milestone |
| Upstream confusion | Name and behavior may appear official | Keep the unofficial notice visible and seek concrete upstream review using evidence | Before launch announcement |

## Stop or pivot conditions

Pivot the project toward the Compatibility Lab and generated Gateway client if:

- a future stable cannot reach a Gateway handshake without changing agent logic;
- identity or provider secrets must be exposed to untrusted workspace code;
- the hosted-runtime dependency or licensing cannot support the intended use;
- supported-browser boot performance makes the one-turn experience impractical.
