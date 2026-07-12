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
  capabilityHandlers
});

// Manifest capabilities start pending, not granted.
session.permissions.approve("storage.snapshot", "workspace:primary", {
  durationMs: 5 * 60_000,
  maxCalls: 1
});

session.mailbox.serve({ signal: shutdown.signal, maxRequests: 100 });
await session.runtime.start({
  executable: "node",
  args: ["guest-adapter.mjs"],
  cwd: "/workspace",
  env: [...session.guestTransport.environment]
});
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
files by hand. Gateway installation remains the next SDK slice. BrowserPod
2.12.1 still lacks documented provider process
termination and hard-disposal APIs; a guest supervisor now handles cooperative
shutdown only for Clawsembly-launched processes.
