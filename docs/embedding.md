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

The assertion currently rejects the checked-in `browserpod@2.12.1` report
because it remains `probing` with no owner-authorized runtime evidence. This is
intentional. Archived evidence from another provider cannot turn BrowserPod
green.

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

Manifest capability rows are permission requests rather than initial grants.
`bootVerifiedEmbed` exposes them as `session.permissions`; the broker remains
default-deny until the trusted host calls `approve` after a user action.
Approvals cannot exceed the requested call budget, expire within 24 hours, and
can be denied or revoked. Current state and combined permission/broker audit are
exported under stable schemas. See
[Capability permission lifecycle](capability-permissions.md).

Embedding hosts can mount `mountCapabilityPermissionPrompt` with
`session.permissions` to expose bounded duration/call controls and exact
approve, deny, and revoke actions. It derives each row from the controller,
keeps authority out of DOM state, and exports audit JSON only after an explicit
user action.

## Evidence-bound boot

`bootVerifiedEmbed` is implemented, but remains unusable with the current
checked-in report because BrowserPod has not earned supported evidence:

```ts
const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  workspaceId: "primary",
  capabilityHandlers,
  gatewayOptions: { allowedOrigins: [globalThis.location.origin] }
});

await session.gateway.start();
const gatewayClient = session.createGatewayClient();
const hello = await gatewayClient.connect();
const removeChatListener = gatewayClient.chat.onEvent(renderChatEvent);
const accepted = await gatewayClient.chat.send({
  sessionKey: "agent:main:clawsembly",
  message: "Hello from the host"
});
await gatewayClient.chat.history({
  sessionKey: "agent:main:clawsembly",
  limit: 50,
  maxChars: 200_000
});
await gatewayClient.chat.abort({
  sessionKey: "agent:main:clawsembly",
  runId: accepted.runId
});
removeChatListener();

const audit = session.capabilities.auditSnapshot();
const result = await session.close();
```

The boot function first calls `assertVerifiedLaunch`, before BrowserPod spends
tokens. It has no `allowUnverified` option and does not accept `latest`, ambient
environment credentials, implicit host filesystem access, or a compatibility
report from another runtime.

Persistent sessions accept a logical `workspaceId`; the SDK derives
`clawsembly:<exact-openclaw-version>:<workspaceId>` as the BrowserPod
`storageKey`. Different OpenClaw versions therefore cannot silently reuse the
same persisted disk.

## BrowserPod lifecycle contract

The BrowserPod 2.12.1 adapter now supports:

- persistent or ephemeral Node 22 boot;
- long-lived command start without waiting for process exit;
- bounded terminal transcript and readiness matching;
- automatic HTTPS portal discovery by internal port;
- bounded text-file reads, writes, and directory creation;
- runtime audit metadata without the BrowserPod API key.

The vendor's published `Process` and `Terminal` types expose no methods, and the
reference documents no process termination, terminal input, or Pod disposal.
The adapter therefore reports these features as unavailable. `terminate()`
fails explicitly and `dispose()` reports a logical-only close with active task
IDs. These are runtime support blockers, not TODOs hidden behind a successful
interface.

## Exact-artifact BrowserPod evidence

`runBrowserPodOpenClawProbe` now composes the adapter into the first real
provider-evidence boundary. In one metered Pod it runs the Node/crypto/SQLite
preflight, installs the exact OpenClaw version, compares the installed
`package-lock.json` SHA-512 with the inspected npm artifact, starts the real
Gateway, observes `[gateway] ready` plus an HTTPS portal, requires HTTP 200 from
guest-local `/healthz` and `/readyz`, and then requires cooperative Gateway
shutdown through a nonce-bound guest supervisor.

The resulting raw record is governed by
`packages/compatibility/browserpod-evidence.schema.json`. Report generation
matches runtime version, browser string, package, OpenClaw version, and
integrity before it promotes only the preflight and boot checks. Handshake,
broker, tool, reconnect, cancellation, persistence, and full performance gates
stay pending. No owner-authorized record is checked in yet; the current public
BrowserPod report therefore remains `probing` and launch remains blocked. See
[BrowserPod evidence workflow](browserpod-evidence.md).

## Typed guest-to-host transport

Every verified boot now creates a fresh BrowserPod filesystem mailbox at a
random per-boot channel path. Its manifest repeats the broker's exact artifact,
runtime, and session subject, but grants remain solely in the in-memory host
broker. The guest cannot edit a file to create authority.

The protocol uses bounded JSON envelopes, monotonic slots, ready markers, exact
capability and scope identifiers, replay rejection, and cancellation markers.
Handler failures are reduced to generic public errors, while transport and
broker audits contain metadata rather than inputs or results. The guest client
uses Node filesystem calls; the host uses only BrowserPod's documented bounded
filesystem adapter. See [BrowserPod capability mailbox](capability-mailbox.md).

The SDK initializes the host side automatically and exposes
`session.mailbox.serve(...)`. It also stages the canonical protocol and Node
client as a generated SHA-256-pinned artifact, reads both files back through the
runtime, and exposes their exact paths plus non-secret command environment as
`session.guestTransport`. Generated-source drift fails the release gate.
The reusable permission prompt covers the host decision UX. The verified
session also exposes `session.installer.install()`, which uses the same
exact-artifact installer as the BrowserPod evidence probe and returns paths only
after installed manifest and package-lock integrity match. Gateway launch,
portal/log readiness, guest-local health checks, explicit connection-token
issuance, and cooperative stop now use the same `session.gateway` controller as
the evidence probe. `gatewayOptions.allowedOrigins` is written through the
exact OpenClaw CLI before launch; only exact HTTPS origins (plus explicit
loopback HTTP origins) are accepted, and `*` is rejected.

`session.createGatewayClient()` is the first generated-client slice. Its
contract records the exact npm integrity plus SHA-256 digests of the upstream
protocol declarations. The handwritten transport waits for
`connect.challenge`, uses a persistent non-extractable browser Ed25519 key to
sign OpenClaw's v3 payload, sends the ephemeral Gateway token only inside the
`connect` frame, requires protocol 4 and an exact-version `hello-ok`, and
returns no bearer token. Pre-authentication frames are capped at 64 KiB and all
errors/audits are reduced to fixed metadata. A first-use or scope-upgrade
`PAIRING_REQUIRED` response returns only the bounded request/device/role/scope
contract; approval remains an explicit owner action.

After authentication, the client admits only `chat.send`, `chat.history`, and
`chat.abort`; it does not expose a generic Gateway request escape hatch.
`chat.send` forces `deliver:false`, excludes attachment and provenance fields,
and returns the exact accepted run id. Chat events are validated as
delta/final/aborted/error, sequence gaps are reported without payloads, history
is count/character bounded, and abort must confirm the requested run id.
Authenticated frames are capped at 4 MiB and pending requests at 64. A socket
loss rejects every pending RPC and moves the client to `disconnected`; calling
`connect()` performs a new signed handshake with the same IndexedDB identity.
The real BrowserPod handshake/turn evidence, pairing approval UI, issued-token
persistence, automatic retry policy, attachments, and remote-mode parity remain
pending.

Use `await session.close()` for ordered teardown. It first requires a successful
cooperative Gateway stop, then closes the logical runtime adapter. The legacy
synchronous `dispose()` path refuses to close while a Gateway is active. Neither
API claims provider-level process termination or hard Pod disposal.
