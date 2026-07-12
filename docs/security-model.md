# Security model

This document describes the intended security boundary. It is not a claim that
the current prototype is production-ready.

## Protected assets

- provider credentials and authentication tokens;
- device identity private key material;
- user conversations, workspace files, and backups;
- native Gateway credentials and endpoint details;
- compatibility-report integrity and release status.

## Trust zones

1. **Application shell** — trusted project code delivered by the Clawsembly origin.
2. **Browser host broker** — the narrow owner of identity, credential, network,
   persistence, and permission operations.
3. **Browser guest runtime** — untrusted runtime containing upstream OpenClaw,
   downloaded packages, model-generated code, plugins, and workspace content.
   BrowserPod is the selected provider; WebContainer is the current evidence
   implementation and container2wasm is an archived feasibility experiment.
4. **External services** — npm, runtime delivery or metering services, model
   providers, and an optional native OpenClaw Gateway.

The browser sandbox is one boundary, not the only control.

## Default rules

- Deny unclassified host calls.
- Never embed or share a device private key.
- Never write plaintext provider secrets into the workspace.
- Validate host-call inputs and destinations outside the guest runtime.
- Require explicit user intent for backup export, native Gateway connection, and
  newly granted capabilities.
- Redact secrets from bounded diagnostic and audit output.
- Pin upstream artifacts by version and integrity.
- Treat report status as a security-sensitive claim backed by stored artifacts.
- Bind every broker session to an exact OpenClaw version and package integrity.
- Require an exact capability and scope grant; do not support wildcard or
  ambient guest authority.
- Keep capability audit records payload-free and bounded.
- Pass the BrowserPod API key only to provider boot; never copy it into guest
  arguments, environment variables, filesystem, runtime objects, or audits.
- Treat BrowserPod portal URLs as publicly reachable and retain Gateway
  authentication and explicit origin policy at that boundary.
- Bind every BrowserPod mailbox to a fresh per-boot channel and the broker's
  exact artifact/runtime/session subject; treat the on-disk manifest only as
  discovery metadata.
- Strictly bound and parse mailbox envelopes, reject replay and traversal, and
  expose only generic transport errors plus payload-free audit metadata.
- Treat cooperative Gateway shutdown separately from provider process
  termination and Pod disposal; never infer the latter from a supervisor exit.

## Release requirements

A release cannot be marked `supported` until it has evidence for:

- exact artifact resolution and integrity;
- clean-environment install behavior;
- WebContainer boot and Gateway handshake;
- unique device identity behavior;
- provider-independent mocked chat with cancellation;
- documented failures for every disabled capability;
- secret-redaction tests and a reviewed dependency inventory.

Live-provider tests are protected CI tests and are never required for a public
pull request from a fork.

## Current persistence boundary

The project page currently persists only deterministic mock OpenClaw state. It
wraps the WebContainer binary export in a versioned manifest with its scope,
OpenClaw version, byte length, and SHA-256 digest before writing it to OPFS or
offering an explicit download. Imports reject unknown versions, malformed
metadata, size mismatches, and digest mismatches.

This integrity check is not encryption. Backups deliberately exclude provider
credentials and must not yet contain sensitive workspaces.

Provider credentials use a separate browser-host vault. A non-extractable
AES-GCM-256 `CryptoKey` is structured-cloned into IndexedDB; each provider record
uses a fresh 96-bit IV, a 128-bit authentication tag, and provider-scoped
additional authenticated data. Only ciphertext and timestamps are stored. The
project page verifies key reload, rejected key export, encrypted round-trip,
wrong-scope rejection, document reload, and explicit deletion without exposing
the test value to WebContainer.

This protects the credential from workspace code and accidental backup export,
not from trusted-origin script injection. A same-origin attacker could ask the
browser to decrypt with the stored key. The deployed page therefore restricts
scripts, frames, network destinations, and form targets with a checked-in CSP;
dependency review and protected broker integration remain release requirements. Browser
quota eviction, site-data clearing, or an origin change can also remove the key
and ciphertext together.

The BrowserPod adapter accepts the provider class through dependency injection;
it does not silently relax that CSP or fetch provider code itself. BrowserPod's
published npm wrapper currently imports its versioned runtime from the vendor
delivery origin. Any host that enables the adapter must pin and review that
delivery path, add only the required CSP destination, and retain an outage path
before it can claim BrowserPod support.

The provider broker is integrated with an actual OpenClaw agent turn but not
enabled for live traffic. It fixes the OpenAI destination to `POST /v1/responses`, sets
`store:false`, rejects redirects, omits ambient browser credentials and the
referrer, bounds JSON responses to 2 MB, suppresses provider error bodies, and
never returns the API key. The browser host selects `gpt-5.6-luna`; it does not
trust the WebContainer's model alias. The loopback bridge receives only flattened
prompt text and validated assistant output, while a short-lived probe credential
remains encrypted in the browser vault and is deleted after the turn.

The browser test uses mock fetch at the exact outbound policy boundary. This
proves OpenClaw integration, authorization-header application, typed Responses
SSE parsing, bounded deltas, validated function-call arguments, an allowlisted
`agents_list` execution/result round-trip, matched `function_call` /
`function_call_output` continuation input, secret non-exposure, and cancellation
propagation without sending data or incurring provider cost. `chat.abort` crosses an
explicit control channel to the matching browser `AbortController`; the test
also verifies that the provider `ReadableStream` receives `cancel()`.

A protected live-test gate now requires a stored credential and explicit
billable-request consent, sends only a fixed prompt, caps output tokens, permits
cancellation, hides partial output, and renders completed output as plain text.
Automation verifies every gate while asserting zero live endpoint requests.
Executing and archiving the first owner-authorized live test, broader moderation
UX, and multi-request scheduling remain release requirements. The current user-configurable request,
input-character, and streamed-output budgets are enforced for the mock-boundary
probe and will gate live opt-in. Partial streamed output has different moderation properties from
a complete response and must be treated as untrusted until the turn finishes.

Device identity uses a separate non-extractable Ed25519 `CryptoKey` in
IndexedDB. The browser exports only the raw public key, derives the device ID as
SHA-256 of those 32 bytes, and signs OpenClaw's v3 challenge payload including
the server nonce, token, role, scopes, client metadata, and platform fields. The
project page verifies persistence, rejected private-key export, a valid
signature, and nonce-mismatch rejection. The end-to-end probe then completes a
real protocol 4 `hello-ok` while passing only the signed device record to a
WebContainer loopback client. A second probe uses OpenClaw's standard local
Control UI identity, receives the issued device token, encrypts it immediately
with the browser-host AES-GCM vault, and completes a token-authenticated
reconnect. The test reloads the document and verifies that only encrypted token
metadata remains available to the page.

The device token must briefly exist in the dedicated WebContainer bridge
process because the Gateway socket is loopback-only. It is not written to the
filesystem, mounted workspace, backup, or diagnostic output. This is a narrower
boundary than exposing the Ed25519 private key, but it is still a bearer-secret
surface and keeps remote approval, rotation, revocation, and recovery as release
gates.

The pinned OpenClaw verifier is patched only when exact release markers match.
Native verification is attempted first; public-key construction or verification
failure falls back to Noble Ed25519, and any upstream source drift fails closed.
This is a compatibility patch, not a bypass: invalid signatures still fail.
Remote user approval, token rotation, revocation, and recovery are not yet
implemented.
