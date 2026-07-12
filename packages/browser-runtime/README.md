# Browser runtime contract

This package keeps BrowserPod-specific behavior behind a provider-neutral,
fail-closed lifecycle surface.

## BrowserPod 2.12.1 adapter

The implemented adapter uses only documented public APIs:

- `BrowserPod.boot` with Node 22 and optional `storageKey` persistence;
- `createCustomTerminal` for bounded output capture;
- `run` for executable/argument-array process launch;
- `onPortal` for HTTPS portal discovery;
- directory and bounded text-file operations.

Long-lived commands are started without awaiting the vendor `run()` promise,
which resolves only when the process finishes. A task can wait for bounded
output readiness and its expected portal independently.

## Exact-artifact readiness probe

`browserpod-openclaw-probe.mjs` composes the runtime contract into an
owner-authorized evidence run. It reuses one metered Pod for the Node preflight,
exact `npm install`, package-lock SHA-512 comparison, real OpenClaw Gateway
start, HTTPS portal discovery, and guest-local `/healthz` plus `/readyz`
checks. It returns a schema-ready evidence object and the still-live Gateway
task; credentials are not serialized into the evidence.

The probe is covered end-to-end with a fake BrowserPod. A real evidence record
is not checked in until an owner runs the same path with a commercial API key.
See [BrowserPod evidence](../../docs/browserpod-evidence.md).

`cooperative-process.mjs` stages a nonce-bound Node supervisor for processes
launched by Clawsembly. The exact-artifact probe now requires that supervisor
to stop the Gateway after readiness. This is a cooperative guest protocol, not
a claim that BrowserPod exposes process termination or Pod disposal.

## Explicit gaps

The published BrowserPod `Terminal` and `Process` types are empty and the 2.12.1
reference documents no terminal input, process termination, or Pod disposal
method. The adapter therefore reports:

- `interactiveInput: false`;
- `processTermination: false`;
- `hardDispose: false`.

`terminate()` throws `unsupported_feature`, and `dispose()` performs only a
logical close while reporting any active task IDs. This must remain a support
blocker for arbitrary process and Pod teardown. Clawsembly-launched Gateway
processes can additionally opt into the documented guest supervisor; the
adapter never fabricates a green provider lifecycle result from that higher
level protocol.

Portal URLs are treated as public URLs, not loopback endpoints or secrets. The
OpenClaw Gateway still requires its own authentication and origin policy. The
shared controller writes only exact HTTPS or loopback origins through the
installed OpenClaw CLI before launch; wildcard and public plaintext HTTP values
are rejected. The embedding client must present the same origin policy before
it can derive a `wss://` portal.

## Credential boundary

The BrowserPod API key is passed only to `BrowserPod.boot`. It is not exposed on
the returned runtime object, added to guest environment variables, command
arguments, output, or audit records.

See [ADR 0003](../../docs/decisions/0003-verified-openclaw-embedding.md) and the
[verified embedding contract](../../docs/embedding.md).
