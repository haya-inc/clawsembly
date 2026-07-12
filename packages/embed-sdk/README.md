# Clawsembly embed SDK core

This package contains the fail-closed launch-manifest and boot slices of the
embedding SDK. `createEmbedManifest` binds a BrowserPod launch to:

- one exact upstream OpenClaw package version and integrity;
- a compatibility report captured for the same runtime;
- an explicit set of exact-scope capability grants.

`assertVerifiedLaunch` accepts only an exact BrowserPod version and stays red
until BrowserPod produces the full supported evidence set.

```js
const manifest = createEmbedManifest({
  report,
  capabilities: [
    { capability: "provider.openai.responses", scope: "model:gpt-5.6-luna", maxCalls: 4 },
    { capability: "storage.snapshot", scope: "workspace:primary", maxCalls: 2 }
  ]
});

assertVerifiedLaunch(manifest);
```

`bootVerifiedEmbed` then boots the BrowserPod adapter and creates a capability
broker plus a fresh filesystem mailbox whose subject is the same exact artifact:

```js
const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  workspaceId: "primary",
  capabilityHandlers,
  gatewayOptions: {
    // Exact browser origins only. Wildcards and non-loopback HTTP fail closed.
    allowedOrigins: [globalThis.location.origin]
  }
});

// Explicitly install the manifest-bound artifact. The SDK exposes no executable
// path until both package.json and package-lock integrity match.
const installed = await session.installer.install();

// Start the same supervised, health-checked Gateway lifecycle used by evidence
// probes, then complete the artifact-matched protocol 4 handshake.
const gateway = await session.gateway.start();
const client = session.createGatewayClient();
let hello;
try {
  hello = await client.connect();
  console.log(hello.protocol, hello.server.version);
} catch (error) {
  if (error.code === "pairing_required") {
    // Review re-reads OpenClaw's current pending list inside BrowserPod and
    // rejects any device/role/scope drift before rendering owner controls.
    const review = await session.gateway.pairing.review(error.pairing);
    mountGatewayPairingPrompt({
      container: pairingContainer,
      review,
      onApprove: (reviewId) => session.gateway.pairing.approve(reviewId),
      onReject: (reviewId) => session.gateway.pairing.reject(reviewId),
      onDecision(decision) {
        if (decision.decision === "approved") void client.connect();
      }
    });
  } else throw error;
}
if (!hello) throw new Error("Pairing decision pending; chat remains locked");

const unsubscribe = client.chat.onEvent((event) => renderChatEvent(event));
const accepted = await client.chat.send({
  sessionKey: "agent:main:clawsembly",
  message: "Hello from the embedding host"
});
const history = await client.chat.history({
  sessionKey: "agent:main:clawsembly",
  limit: 50,
  maxChars: 200_000
});
await client.chat.abort({
  sessionKey: "agent:main:clawsembly",
  runId: accepted.runId
});
unsubscribe();

// Manifest capabilities start pending, not granted.
session.permissions.approve("storage.snapshot", "workspace:primary", {
  durationMs: 5 * 60_000,
  maxCalls: 1
});

session.mailbox.serve({ signal: shutdown.signal, maxRequests: 100 });
await session.runtime.start({
  executable: "node",
  args: [installed.executablePath, "--help"],
  cwd: installed.root,
  env: [...session.guestTransport.environment]
});

await session.close();
```

There is intentionally no `allowUnverified` option. Provider probes use the
lower-level BrowserPod adapter until BrowserPod earns a `supported` report.
Persistent storage keys are derived as
`clawsembly:<exact-openclaw-version>:<workspaceId>` so an upgrade cannot
silently mount the previous artifact's disk.

`manifest.capabilities` are exact permission requests. Verified boot creates no
initial broker grants. The host renders `session.permissions.manifest()`, then
calls `approve`, `deny`, or `revoke` from explicit user actions. Approval cannot
exceed the requested call limit and always expires within 24 hours. Stable,
payload-free state and audit exports are available from `manifest()` and
`exportAudit()`.

Embedding hosts can render the controller with
`mountCapabilityPermissionPrompt`. The framework-neutral DOM component exposes
only bounded duration/call inputs and exact approve, deny, and revoke actions;
audit download remains an explicit user action.

The mailbox provides typed exact-scope guest requests, replay rejection,
bounded responses, cancellation, and payload-free transport audit without
terminal input. Verified boot stages a generated, SHA-256-pinned guest client,
reads both modules back, and returns its paths plus explicit non-secret command
environment in `session.guestTransport`; integrators no longer copy protocol
files by hand. `session.installer` writes an exact dependency manifest, runs one
bounded npm install, and exposes its executable only after installed version and
package-lock integrity match the verified embed manifest. Gateway launch and
readiness use the same controller as evidence probes: a private ephemeral
token, exact browser-origin policy, loopback bind, HTTPS portal discovery,
`/healthz` and `/readyz`, and a cooperative supervisor stop.
`session.gateway.connection()` is the internal authority source and becomes
unavailable after stop. `session.createGatewayClient()` consumes it only during
the protocol 4 handshake: it waits for `connect.challenge`, signs the exact v3
device payload with a persistent non-extractable Ed25519 key, sends shared or
device auth only inside `connect.params.auth`, validates `hello-ok`, and returns
a token-free summary. First-use or scope-upgrade pairing is surfaced as bounded
metadata and `session.gateway.pairing.review()` re-reads the exact pending
request through the artifact-pinned OpenClaw CLI. The framework-neutral prompt
requires an explicit owner approve/reject action; approval is one-shot, expires
after five minutes, and is refused if the device, role, or scopes changed.
Issued tokens are encrypted with a non-extractable AES-GCM key in a separate
IndexedDB vault bound to artifact, device, role, and scopes. Reconnect signs and
authenticates with that device token; a mismatch clears it before a later
explicit connect can fall back to shared auth. The generated
contract is pinned to the same npm artifact and can be reproduced with
`npm run protocol:verify`. The post-authentication surface is deliberately
limited to generated `chat.send`, `chat.history`, and `chat.abort` contracts.
It caps payloads and pending requests, delivers validated delta/final/aborted/
error events, detects sequence gaps, rejects pending work on disconnect, and
can perform a fresh signed `connect()` with the same device identity. Arbitrary
Gateway RPC, outbound delivery, attachments, automatic retry/backoff, remote
pairing approval, token rotation/revocation, and recovery remain unavailable.
`session.close()` orders cooperative Gateway stop before logical runtime
disposal; synchronous `dispose()` refuses to close a session while a Gateway is
active, so the stop control path cannot be cut off accidentally.
BrowserPod 2.12.1 still lacks documented provider process
termination and hard-disposal APIs; a guest supervisor now handles cooperative
shutdown only for Clawsembly-launched processes.
