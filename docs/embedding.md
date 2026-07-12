# Verified embedding contract

Clawsembly's embedding contract separates four decisions that are often
collapsed into one unsafe “run the agent” button:

1. **Artifact:** the exact upstream `openclaw` package version and integrity.
2. **Evidence:** the compatibility report earned by that artifact on that
   runtime provider.
3. **Authority:** the exact browser-host capabilities granted to the guest.
4. **Runtime:** BrowserPod, selected independently from the other three.

## Current API slices

The launch-manifest core is implemented in
`packages/embed-sdk/embed-manifest.mjs`:

```js
import {
  assertVerifiedLaunch,
  createEmbedManifest
} from "./packages/embed-sdk/embed-manifest.mjs";

const manifest = createEmbedManifest({
  report,
  runtime: "browserpod",
  capabilities: [
    {
      capability: "provider.openai.responses",
      scope: "model:gpt-5.6-luna",
      maxCalls: 4
    },
    {
      capability: "storage.snapshot",
      scope: "workspace:primary",
      maxCalls: 2
    }
  ]
});

assertVerifiedLaunch(manifest);
```

The assertion currently rejects the checked-in report because that runtime
evidence belongs to WebContainer and remains `partial`. This is intentional.
BrowserPod adoption cannot silently turn another provider's evidence green.

## Capability request contract

Host authority crosses `CapabilityBroker.request`:

```js
const broker = new CapabilityBroker({
  subject: {
    artifact: {
      package: "openclaw",
      version: manifest.artifact.version,
      integrity: manifest.artifact.integrity
    },
    runtime: "browserpod",
    sessionId
  },
  grants: manifest.capabilities,
  handlers: {
    "provider.openai.responses": hostProviderHandler,
    "storage.snapshot": hostSnapshotHandler
  }
});

await broker.request({
  id: requestId,
  capability: "storage.snapshot",
  scope: "workspace:primary",
  input: snapshotRequest
}, { signal });
```

Authorization is an exact `(capability, scope)` match. There are no wildcard
scopes or ambient credentials. Call limits are consumed before asynchronous
handler work so concurrent requests cannot overspend one grant.

## Initial capability vocabulary

| Capability | Example scope | Host responsibility |
| --- | --- | --- |
| `provider.openai.responses` | `model:gpt-5.6-luna` | credential injection, destination policy, budgets, response validation |
| `identity.sign` | `challenge:gateway` | non-extractable device key and challenge validation |
| `storage.snapshot` | `workspace:primary` | versioned, integrity-protected persistence |
| `storage.restore` | `workspace:primary` | manifest validation and explicit restore |
| `notification.show` | `channel:browser` | browser permission and user-visible notification |
| `network.fetch` | `origin:https://example.com` | destination, method, redirect, size, and credential policy |

Vocabulary is not permission. A capability is unavailable until the host
registers a handler and an explicit, unexpired grant exists for its exact scope.

## Planned public SDK

The public API will be promoted only after BrowserPod earns supported evidence:

```ts
const claw = await Clawsembly.boot({ manifest, browserPodApiKey });
await claw.gateway.ready();
const audit = claw.capabilities.auditSnapshot();
await claw.dispose();
```

`boot()` must not accept `latest`, ambient environment credentials, implicit
host filesystem access, or a compatibility report from another runtime.
