# BrowserPod capability mailbox

The capability mailbox is Clawsembly's typed guest-to-host transport for
BrowserPod. It uses only the documented filesystem API and does not depend on
terminal input, an undocumented process handle, a remote sandbox, or ambient
guest authority.

## Protocol

The host creates a unique per-boot channel directory and writes a manifest that
contains the exact broker subject and byte limits. Each request uses one
monotonic slot:

```text
request-00000001.json
request-00000001.ready
cancel-00000001.ready          # optional
response-00000001.json
response-00000001.ready
```

The ready marker is written only after its JSON payload is closed. Neither side
needs directory listing or filename discovery. The host advances to the next
slot only after writing a bounded response.

Requests contain exactly `channelId`, `sequence`, `id`, `capability`, `scope`,
and `input` plus the schema version. Extra fields, malformed identifiers,
traversal paths, duplicate request IDs, wrong slots, and oversized JSON are
rejected before the capability broker runs.

The channel manifest is discovery data, not authority. The host always uses
the in-memory `CapabilityBroker` created from the verified embed manifest. A
guest editing its manifest or request cannot create a grant.

## Host integration

`bootVerifiedEmbed` initializes a fresh random mailbox channel whose subject is
the same exact artifact/runtime/session as the broker:

```js
const session = await bootVerifiedEmbed({
  manifest,
  BrowserPod,
  browserPodApiKey,
  capabilityHandlers
});

const serving = new AbortController();
const hostLoop = session.mailbox.serve({
  signal: serving.signal,
  maxRequests: 100
});

await session.runtime.start({
  executable: "node",
  args: ["guest-adapter.mjs"],
  cwd: "/workspace",
  env: [...session.guestTransport.environment]
});
```

The random channel identifier is also part of the guest path. Reusing a
persistent workspace therefore cannot silently replay stale slots from an
earlier embed boot.

## Exact guest artifact

`mailbox:generate` deterministically packages the canonical protocol and Node
client sources into one checked-in host artifact. It records a SHA-256 for each
file and the combined artifact. `mailbox:check` runs in the normal release gate
and fails when either canonical source changes without regeneration.

Verified boot writes both modules into the fresh channel, verifies their
source digests before writing, reads the exact text back through BrowserPod's
bounded file API, and only then exposes `session.guestTransport`. The returned
record contains the client entrypoint, mailbox root, channel, file metadata,
and explicit environment strings. None are credentials or grants.

## Guest integration

The guest adapter imports the staged entrypoint and connects with the supplied
non-secret environment:

```js
const { FilesystemCapabilityMailboxClient } = await import(
  process.env.CLAWSEMBLY_MAILBOX_CLIENT
);

const client = new FilesystemCapabilityMailboxClient({
  root: process.env.CLAWSEMBLY_MAILBOX_ROOT,
  channelId: process.env.CLAWSEMBLY_MAILBOX_CHANNEL
});
await client.connect();

const snapshot = await client.request({
  id: crypto.randomUUID(),
  capability: "storage.snapshot",
  scope: "workspace:primary",
  input: { reason: "user export" }
}, { signal });
```

The client uses exclusive file creation and removes completed slot files on a
best-effort basis. A persistent guest can retain its own request or granted
response data, just as it can retain any other data it already controls. Do not
send BrowserPod keys, provider credentials, or other host-only secrets through
this transport.

## Cancellation and errors

When the guest `AbortSignal` fires, the client writes the matching cancel
marker. The host aborts the exact broker request, which propagates the signal to
the capability handler. Handler exceptions are converted to generic error
codes; underlying messages and payloads do not enter broker or mailbox audit
records.

Host responses are JSON-bounded independently from requests. Cyclic or
oversized handler output becomes `transport_failed` or `response_too_large`
rather than breaking the channel or leaking serialization details.

## Cooperative Gateway stop

`startCooperativeProcess` writes a small Node supervisor into the guest. The
supervisor spawns the Gateway, inherits its explicitly supplied environment,
and watches a nonce-bound stop file. A matching stop sends `SIGTERM`, followed
by `SIGKILL` only after the configured grace period.

The supervisor config contains executable, arguments, cwd, control path, nonce,
and grace period. Environment values such as the ephemeral Gateway token are
passed at process start and are not persisted into that config.

This provides evidence for cooperative shutdown of Clawsembly-launched
processes. It does not change the provider capability flags:

- BrowserPod process termination remains unavailable;
- arbitrary guest processes cannot be force-stopped through the adapter;
- Pod hard disposal remains unavailable.

The exact-artifact readiness probe now requires a successful cooperative
Gateway stop before emitting evidence.
