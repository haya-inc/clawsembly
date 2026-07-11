# Proposed architecture

This is the initial architecture hypothesis. The first compatibility probe may
change implementation details, but the upstream boundary should remain stable.

## System overview

```mermaid
flowchart LR
    UI["Browser UI"]
    Client["Generated Gateway client"]
    Selector["Runtime selector"]
    Embedded["Embedded OpenClaw\nin WebContainer"]
    Remote["Native OpenClaw Gateway"]
    Adapter["Browser compatibility adapter"]
    Host["Browser host capabilities"]
    Store["OPFS / IndexedDB"]

    UI --> Client --> Selector
    Selector --> Embedded
    Selector --> Remote
    Embedded --> Adapter --> Host
    Host --> Store
```

## Runtime modes

### Embedded mode

The browser boots a WebContainer, installs or mounts a pinned upstream OpenClaw
package, applies a versioned compatibility manifest, and starts a constrained
Gateway. This mode favors privacy, disposability, and zero infrastructure.

Expected initial capabilities:

- browser chat and streamed model responses;
- provider HTTP calls through an audited host bridge where necessary;
- a workspace stored in the WebContainer and persisted through OPFS;
- JavaScript or Wasm-based constrained tool execution;
- Gateway health, session, and chat operations.

Expected initial exclusions:

- native addons and native subprocess binaries;
- host browser control through Playwright/CDP;
- mDNS, raw TCP/UDP listeners, and LAN discovery;
- messaging integrations requiring unsupported native libraries;
- reliable background execution after the browser runtime is terminated.

### Remote mode

The UI connects to an ordinary native OpenClaw Gateway over its documented
WebSocket protocol. Remote mode provides full OpenClaw host capabilities and a
fallback when an upstream release cannot yet run in the embedded environment.

Both modes should expose the same UI-facing client interface. Feature discovery
determines which actions are shown or enabled.

## Components

### Application shell

Owns onboarding, runtime selection, status, terminal and log surfaces, and
browser permission prompts. It must not contain OpenClaw agent logic.

### Generated Gateway client

Generated from the upstream Gateway schema and wrapped by a small handwritten
transport layer. It should:

- negotiate the supported protocol range;
- honor limits advertised by `hello-ok`;
- discover supported methods and events;
- preserve unknown event or frame payloads for forward compatibility;
- avoid depending on private OpenClaw workspace packages at runtime.

OpenClaw documents its Gateway protocol and TypeBox code-generation pipeline in
[Gateway protocol](https://docs.openclaw.ai/gateway/protocol) and
[TypeBox](https://docs.openclaw.ai/concepts/typebox).

### Embedded runtime manager

Boots and tears down the WebContainer, mounts workspace files, installs the
pinned OpenClaw artifact, launches the Gateway, captures diagnostics, and
publishes runtime capabilities.

### Compatibility adapter

Contains browser-specific behavior that upstream OpenClaw does not provide.
The adapter is configured by a versioned manifest rather than scattered
version checks.

Responsibilities include:

- dependency and loader overrides;
- environment and configuration normalization;
- browser-host device-signature bridging;
- network and storage host bridges;
- unsupported-capability errors;
- structured startup and health diagnostics.

### Browser host

Runs outside the WebContainer and owns privileged browser APIs. Candidate
interfaces include:

- `identity.generate`;
- `storage.snapshot`, `storage.restore`, and `storage.persist`;
- `http.fetch` with destination and credential policy;
- `notify` and browser permission mediation;
- future WIT-based Wasm capability invocation.

Every interface should be narrow, typed, cancellable, and auditable.

## Persistence

The first implementation should separate:

- structured application metadata in IndexedDB;
- workspace files and runtime snapshots in OPFS;
- secrets as non-extractable Web Crypto keys and encrypted IndexedDB records;
- exportable user backups in an explicit, versioned format.

The current compatibility probe exports mock OpenClaw state as a WebContainer
binary snapshot and wraps it in a v1 manifest with the OpenClaw version, scope,
length, and SHA-256 digest. It writes that envelope to OPFS, boots a fresh
runtime, validates and mounts the payload, and verifies transcript contents.
The user-facing format still needs workspace migration fixtures, encryption,
and workspace-scale recovery before it is a production backup contract.

The browser host now has a separate credential-vault slice. It stores a
non-extractable AES-GCM key and provider-scoped ciphertext in IndexedDB and
never mounts those records into WebContainer. This proves the at-rest boundary;
provider requests traverse a fixed-destination host broker. Its mock transport
probe enforces the official Responses endpoint, stateless storage, rejected
redirects, bounded JSON, and secret-safe errors. A bounded loopback provider
translates OpenClaw's local Chat Completions request into a browser-host message;
the host ignores the WebContainer model alias, selects `gpt-5.6-luna`, calls the
Responses policy, parses typed SSE text and function-call events, and forwards
only validated deltas or calls. The loopback side converts a function call into
Chat Completions `tool_calls`; OpenClaw executes the allowlisted `agents_list`
tool, returns its result, and the host converts the matched call/result history
into Responses `function_call` and `function_call_output` input items before a
second broker request. Historical results are not mistaken for a continuation
after a newer user message. For cancellation,
the Gateway probe sends `chat.abort` and an explicit adapter control message;
the browser aborts the matching provider controller and the Responses body is
cancelled. The explicit control message is required because WebContainer's HTTP
compatibility layer does not surface client fetch abort as a server-side close
event. The probe uses mock fetch at the exact external boundary, so the
continuation payload is verified but live requests remain disabled.

The loopback provider accepts only `broker-v1`, validates an ephemeral bridge
capability, caps body and input size, and has a four-request budget. These are
defense-in-depth controls rather than a tenant boundary because workspace code
can read the local OpenClaw configuration. Provider credentials remain solely
in the browser-host vault. A second browser-host budget is user-configurable
before startup and counts requests, serialized Responses input characters, and
streamed text/function-argument characters across the session. Exceeding any
dimension rejects the request and cancels an active provider body.

The project page also exposes a protected live smoke-test surface. It is locked
unless an `openai` credential exists in the browser vault and the user checks a
billable-request disclosure. The request contains one fixed probe prompt, sets
`store:false` and `max_output_tokens:128`, and can be cancelled. No workspace,
chat, tool-result, device-token, or backup content is accepted by this path.
Partial output is never rendered; only a completed, validated response is
inserted with `textContent`. The cost preview uses a conservative byte-based
input estimate, the official `gpt-5.6-luna` standard token rates, and a regional
uplift margin, rounded upward to $0.001. Automated tests arm the gate but assert
that no live endpoint request occurs.

Device identity is owned by a second IndexedDB database. The browser creates a
non-extractable Ed25519 private key, derives the OpenClaw-compatible device ID
from the raw public key, and signs the exact v3 challenge payload. A loopback
probe process passes only the challenge and signed public device record across
the boundary; it never receives the private key. WebContainer's `node:crypto`
cannot construct the current verifier key, so the pinned 2026.6.11 artifact uses
an exact-marker, fail-closed source patch that falls back to Noble Ed25519
verification. Upstream marker drift aborts installation instead of weakening
verification.

The local Control UI probe then follows OpenClaw's ordinary
`openclaw-control-ui` / `webchat` policy. OpenClaw silently approves this
loopback-local device, issues a device token, and accepts a second signed
connection authenticated only with that token. The browser host encrypts the
token with the credential-vault AES key and retains it across document reload.
Because WebContainer cannot expose its loopback socket directly to the page,
the token exists briefly in a dedicated bridge process; it is never mounted,
persisted in the workspace, or copied into diagnostics.

Clearing site data can remove all browser-owned state, so users need a visible
backup and restore path before Clawsembly is considered production-ready.

## Security boundaries

- Treat model output, workspace code, plugins, and downloaded packages as
  untrusted.
- Do not expose general host filesystem access in embedded mode.
- Do not persist plaintext provider secrets into workspace files.
- Generate a unique device identity for each installation; never ship a shared
  private key.
- Deny unsupported or unclassified host calls by default.
- Record network, process, file, and capability decisions in a bounded audit
  stream with secret redaction.
- Make the browser sandbox an additional boundary, not the only security
  control.

## Open design questions

- Can the Noble verifier fallback be replaced by an upstream WebContainer-safe
  verification path?
- Which current native dependencies are imported eagerly during minimal boot?
- How should remote approval, device-token rotation, revocation, and recovery
  be surfaced without expanding the bridge process authority?
- Should workspace persistence use file-level synchronization or runtime
  snapshots?
- Which host interfaces should become WIT components first?
- What browser and mobile support baseline is practical for WebContainers?
