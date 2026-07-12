# Project vision

## Problem

OpenClaw is designed around a long-lived Node.js Gateway with access to host
files, networking, subprocesses, databases, browsers, and messaging channels.
That architecture is powerful, but it requires a machine, container, or hosted
service that users must operate and trust.

Modern browsers already provide a sandbox, persistent origin-scoped storage,
Web Workers, WebAssembly, and browser-hosted Node-compatible runtimes. A useful
subset of the OpenClaw experience should be able to run in that environment
without giving the agent unrestricted access to the user's machine.

## Vision

Clawsembly is an evidence-gated embedding layer that runs upstream coding
agents browser-locally, behind a host boundary the embedding application
controls. OpenClaw is the first supported upstream: Clawsembly binds an exact
OpenClaw artifact to public compatibility evidence, a BrowserPod runtime, and
explicit browser-host capabilities.

An embedded upstream should feel like the same agent running in a different
host environment, rather than a separate agent that happens to resemble it.
BrowserPod supplies execution; Clawsembly supplies the verified artifact, the
upstream-portable authority boundary, protocol integration, and the evidence
required to trust that execution. Today only OpenClaw is bound; upstream
portability is a design property of the host boundary, not a demonstrated
multi-upstream capability.

## Principles

### Upstream first

Use the published OpenClaw package and documented Gateway contracts. Do not
copy the agent loop, session model, provider routing, or prompt construction
unless an upstream-independent implementation is unavoidable.

### No permanent source fork

Platform differences belong in loaders, host adapters, generated protocol
clients, and versioned compatibility manifests. Source patches are a last
resort and should be small enough to remove or upstream.

### Capabilities over pretend parity

The browser cannot provide every host capability. Unsupported features must be
discoverable and fail with actionable errors. A no-op replacement that lets
startup succeed while breaking later is not considered compatibility.

### Secure host boundary

Model-generated code is untrusted. Secrets, host calls, persistence, and
network access must cross narrow, auditable boundaries. Clawsembly must not
ship a shared device identity or embedded secret.

### Upstream-portable boundary

Host-boundary APIs — the capability broker, embed manifest, permission UI, and
capability mailbox — must not hard-code OpenClaw specifics. Anything
upstream-specific belongs in a binding that satisfies a documented
upstream-binding contract.

### Automated upstream tracking

An OpenClaw release should trigger a machine-generated compatibility report and
upgrade pull request. Routine compatible releases should not require manual
code edits.

### Evidence-bound embedding

Selecting a runtime does not prove compatibility. Every launch manifest binds
the exact OpenClaw integrity, runtime provider, evidence status, and explicit
capability grants. Evidence from one provider cannot authorize another.

### Useful degradation

The same application should support two runtime modes:

- an embedded browser runtime for local, constrained operation;
- a remote mode that connects to a native OpenClaw Gateway when full host
  capabilities or always-on operation are required.

## Initial scope

- Boot upstream OpenClaw inside a browser-hosted Node/WebAssembly environment.
- Support browser chat, LLM provider calls, session state, and a constrained
  file workspace.
- Provide an OpenClaw Gateway client generated from upstream schemas.
- Provide a default-deny browser capability broker and verified embedding
  manifest for BrowserPod hosts.
- Record an explicit capability matrix for each supported OpenClaw version.
- Persist browser-owned state without exposing the user's general filesystem.

## Non-goals for the first release

- Full parity with every OpenClaw channel and companion application.
- Host Chrome automation, arbitrary native binaries, mDNS, or raw sockets.
- Reliable always-on work after the browser and service worker are terminated.
- Hiding browser limitations behind unsafe polyfills.
- Presenting Clawsembly as an official OpenClaw distribution.

## Success criteria

Clawsembly reaches its first meaningful release when it can:

1. boot a pinned stable upstream OpenClaw version without modifying its source;
2. complete a streamed browser-chat turn with tool use;
3. persist and restore a constrained workspace;
4. explain every disabled capability;
5. validate a new upstream stable version through automation;
6. connect the same UI to a native OpenClaw Gateway as a fallback.
