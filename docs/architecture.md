# Proposed architecture

This architecture preserves browser-local execution while making the product a
verified embedding layer rather than a runtime wrapper. BrowserPod is the
only embedded provider in the main branch. Superseded provider code and evidence
are available through Git history, not through a current runtime branch.
See [ADR 0002](decisions/0002-commercial-browser-runtime.md) and
[ADR 0003](decisions/0003-verified-openclaw-embedding.md).

## System overview

```mermaid
flowchart LR
    UI["Browser UI"]
    Manifest["Verified embed manifest"]
    Client["Generated Gateway client"]
    Contract["BrowserRuntime contract"]
    Commercial["BrowserPod selected\ncommercial browser runtime"]
    Remote["Optional native Gateway"]
    Adapter["Browser compatibility adapter"]
    Broker["Default-deny capability broker"]
    Host["Browser host handlers"]
    Store["OPFS / IndexedDB"]

    UI --> Manifest --> Client --> Contract
    Manifest --> Broker
    Contract --> Commercial
    Contract -. optional interop .-> Remote
    Commercial --> Adapter
    Adapter --> Broker --> Host
    Commercial --> Broker
    Host --> Store
```

## Runtime modes

### Embedded mode

The browser boots a runtime provider, installs or mounts a pinned upstream
OpenClaw package, applies a versioned compatibility manifest, and starts a
constrained Gateway. Execution and workspace state remain in the browser tab.
BrowserPod is the selected embedded provider. It is not supported until it
earns the acceptance evidence defined by ADR 0002. container2wasm is retained
only as an archived feasibility record after its measured boot failure.

Expected initial capabilities:

- browser chat and streamed model responses;
- provider HTTP calls through an audited host bridge where necessary;
- a workspace stored in the guest and persisted through IndexedDB or OPFS;
- JavaScript or Wasm-based constrained tool execution;
- Gateway health, session, and chat operations.

Expected initial exclusions:

- native addons and native subprocess binaries;
- host browser control through Playwright/CDP;
- mDNS, raw TCP/UDP listeners, and LAN discovery;
- messaging integrations requiring unsupported native libraries;
- reliable background execution after the browser runtime is terminated.

### Optional remote mode

The UI may connect to an ordinary native OpenClaw Gateway over its documented
WebSocket protocol for interoperability. It is not the default and cannot be
used to satisfy browser-runtime acceptance gates.

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

### Browser runtime manager

Boots and tears down a selected browser runtime, mounts workspace files,
installs the pinned OpenClaw artifact, launches the Gateway, captures
diagnostics, and publishes runtime capabilities. Provider-specific behavior
must stay behind a contract covering process execution, terminal I/O, file
operations, local service discovery, persistence, cancellation, and teardown.

The first BrowserPod preflight is intentionally dependency-injected. It checks
the exact Node 22.19+ baseline, `node:crypto`, and `node:sqlite` without loading
proprietary runtime code or transmitting a metered API key until the caller
explicitly opts in. The archived container2wasm lane retains its pinned Node
22.19 amd64 conversion, size, boot failure, and license evidence separately.

The BrowserPod lifecycle adapter now starts long-running processes without
awaiting their completion, captures bounded terminal output, waits for exact
readiness text and HTTPS portals, uses `storageKey` persistence, and closes
every filesystem handle. BrowserPod 2.12.1 documents no terminal input,
process termination, or Pod disposal, so the contract exposes those features
as false and refuses to claim complete teardown.

The provider-free page and browser-host suite currently declares desktop
Chromium as its first browser baseline. Firefox and WebKit belong to a separate
BrowserPod provider matrix after owner-authorized runtime evidence is
available. TypeScript remains at ES2023 as the conservative web/public-API
output floor even though the guest runtime itself requires Node 22.19 or newer.

The BrowserPod evidence runner composes that contract without adding a second
provider-specific control path. It verifies Node/crypto/SQLite, performs the
exact npm install, matches the installed lock integrity, starts the real
Gateway, and gathers log, portal, `/healthz`, and `/readyz` evidence. Raw
records are schema-validated and only promote matching runtime-version,
browser, and artifact checks; they do not imply protocol or broker support.

Clawsembly-launched long-running commands may use a guest-local cooperative
supervisor. A nonce-bound stop file requests `SIGTERM`, followed by `SIGKILL`
after a grace period, without persisting process environment values. This
closes the Gateway task used by the evidence probe, but does not imply provider
process termination or Pod hard disposal.

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

Runs outside the guest runtime and owns privileged browser APIs. Candidate
interfaces include:

- `identity.generate`;
- `storage.snapshot`, `storage.restore`, and `storage.persist`;
- `http.fetch` with destination and credential policy;
- `notify` and browser permission mediation;
- future WIT-based Wasm capability invocation.

Every interface should be narrow, typed, cancellable, and auditable.

BrowserPod guest calls cross this boundary through a filesystem mailbox. The
host writes the exact broker subject and byte limits into a per-boot channel;
the guest writes monotonic request slots and cancellation markers. The host
strictly parses bounded envelopes, rejects replay, invokes only its in-memory
broker, and returns generic bounded responses. Mailbox metadata is discovery,
never authority. See [BrowserPod capability mailbox](capability-mailbox.md).

The canonical Node guest client and protocol are compiled into a deterministic
host artifact with per-file and combined SHA-256 identifiers. Verified boot
checks the source digests, stages both modules inside the fresh channel, reads
them back byte-for-byte, and returns only explicit paths and non-secret command
environment. CI rejects any generated artifact that drifts from canonical
source.

### Capability broker

The broker is the product security boundary between the untrusted guest and
browser-host authority. A session is bound to an exact OpenClaw version and
integrity. Requests require an exact capability and scope grant; unknown,
expired, revoked, or exhausted grants fail closed.

The implemented broker consumes call limits before asynchronous dispatch,
propagates cancellation, redacts handler failures, and stores only bounded
audit metadata. Payloads and results never enter the audit trail. See
[Verified embedding contract](embedding.md).

Embed-manifest capability rows enter a consent controller as pending requests,
not grants. Only an exact user approval can create a broker grant, its call
limit cannot exceed the request, and it expires within 24 hours. Deny, revoke,
and expiry decisions use fixed reason codes. Current permission state and the
combined permission/broker audit have stable JSON schemas. See
[Capability permission lifecycle](capability-permissions.md).

### Embed manifest

The embed manifest combines artifact identity, compatibility evidence,
BrowserPod selection, and capability grants. Verified launch remains blocked
while the checked-in BrowserPod report has a status below `supported`. Evidence
from any other provider is rejected. This prevents a provider decision from
becoming an unsupported compatibility claim.

The active implementation follows the same boundary in code:
`browserpod-runtime.mjs` owns the documented provider API,
`browserpod-openclaw-probe.mjs` owns exact-artifact readiness evidence,
`boot.mjs` owns verified launch, and the capability-mailbox modules own guest
transport. The project page and compatibility packages contain only BrowserPod
runtime contracts.

## Persistence

The first implementation should separate:

- structured application metadata in IndexedDB;
- workspace files and runtime snapshots in OPFS;
- secrets as non-extractable Web Crypto keys and encrypted IndexedDB records;
- exportable user backups in an explicit, versioned format.

BrowserPod workspace migration fixtures, encryption, and workspace-scale
recovery remain required before a production backup contract exists.

The browser host now has a separate credential-vault slice. It stores a
non-extractable AES-GCM key and provider-scoped ciphertext in IndexedDB and
never exposes those records to a guest runtime. The active provider policy
enforces the official Responses endpoint, stateless storage, rejected
redirects, bounded JSON, user-configurable request/input/output budgets, and
secret-safe errors. BrowserPod must invoke that policy through the typed
capability mailbox.

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
from the raw public key, and signs the exact v3 challenge payload. The page
proves persistence, non-extractability, signing, and nonce rejection without a
guest runtime. BrowserPod pairing and token reconnect remain pending provider
evidence.

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

- Which current native dependencies are imported eagerly during minimal boot?
- How should remote approval, device-token rotation, revocation, and recovery
  be surfaced without expanding the bridge process authority?
- Should workspace persistence use file-level synchronization or runtime
  snapshots?
- Which host interfaces should become WIT components first?
- What browser and mobile support baseline is practical for BrowserPod?
