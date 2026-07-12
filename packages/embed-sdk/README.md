# Clawsembly embed SDK core

This package contains the fail-closed launch-manifest and boot slices of the
embedding SDK. `createEmbedManifest` binds a BrowserPod launch to:

- one exact upstream OpenClaw package version and integrity;
- a compatibility report captured for the same runtime;
- an explicit set of exact-scope capability grants.

Selecting BrowserPod does not make a report portable from another runtime.
`assertVerifiedLaunch` rejects the current WebContainer evidence and will stay
red until BrowserPod reproduces the full supported evidence set.

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

session.mailbox.serve({ signal: shutdown.signal, maxRequests: 100 });
```

There is intentionally no `allowUnverified` option. Provider probes use the
lower-level BrowserPod adapter until BrowserPod earns a `supported` report.
Persistent storage keys are derived as
`clawsembly:<exact-openclaw-version>:<workspaceId>` so an upgrade cannot
silently mount the previous artifact's disk.

The mailbox provides typed exact-scope guest requests, replay rejection,
bounded responses, cancellation, and payload-free transport audit without
terminal input. Package the guest client and protocol modules with the OpenClaw
adapter. Gateway installation and user-facing permission prompts remain next
SDK slices. BrowserPod 2.12.1 still lacks documented provider process
termination and hard-disposal APIs; a guest supervisor now handles cooperative
shutdown only for Clawsembly-launched processes.
