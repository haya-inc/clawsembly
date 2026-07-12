# Clawsembly embed SDK core

This package contains the fail-closed launch-manifest slice of the planned
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

Runtime boot, Gateway lifecycle, and user-facing permission prompts remain the
next SDK slices. They must consume this manifest rather than accepting an
unversioned package name or ambient host authority.
