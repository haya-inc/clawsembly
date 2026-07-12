# ADR 0002: Keep execution browser-local and replace the production runtime boundary

- Status: accepted; BrowserPod selected by ADR 0003, support evidence pending
- Date: 2026-07-12

## Context

Clawsembly's useful product property is that OpenClaw executes in the user's
browser. Moving the sandbox to a server would lose local data ownership,
offline potential, client-side scale, and the security boundary the project is
designed to study.

The existing Chromium evidence uses WebContainer and remains technically
valuable. It is not a production-runtime commitment: its hosted engine and
commercial terms do not fit the intended commercially deployable OSS path.

OpenClaw requires Node 22.19 or newer. That rules out browser PC emulators which
only support 32-bit guests: v86 does not support 64-bit kernels, current CheerpX
documents 32-bit x86 execution, and official Node 22 Linux artifacts do not
include an x86 build.

## Decision

Browser-local execution is a product invariant. A remote Gateway can remain an
optional interoperability mode, but it is not the replacement for embedded
execution.

The application will depend on a small `BrowserRuntime` boundary instead of a
WebContainer-specific API. ADR 0003 subsequently selected BrowserPod as the
first production target while retaining the evidence gates below:

1. **BrowserPod 2.x is the adopted commercial integration provider.** It runs
   Node 22 in the browser, documents IndexedDB persistence, and explicitly
   permits commercial use on paid plans. It is proprietary, requires a metered
   API key, loads runtime code from vendor infrastructure unless an Enterprise
   agreement provides self-hosting, and does not yet have Clawsembly runtime
   evidence. Provider selection does not make it `supported`; those constraints
   remain visible to users.
2. **container2wasm v0.8.4 is an archived open feasibility lane.**
   It can package an amd64 Linux container for browser execution and the
   converter is Apache-2.0. The project labels itself experimental; its output
   includes a Linux guest, Bochs/QEMU, and container packages with separate
   redistribution obligations. Performance, artifact size, persistence, and
   browser networking are unproven for OpenClaw. The first pinned Node 22.19.0
   probe produced a 316,700,841-byte module after 1,625.84 seconds, but
   Wasmtime v33.0.2 exited 1 before running the guest command. A 512 MB debug
   rebuild reached the OCI root mount while creating the snapshot but failed
   the same final execution gate. Browser conversion is deferred until that
   host feasibility failure is resolved.

WebContainer stays only as the current compatibility-evidence baseline until a
replacement earns the same end-to-end Gateway evidence. New application code
must not deepen the WebContainer coupling.

## Runtime acceptance gates

A candidate becomes the default only after checked-in Chromium evidence proves:

- exact Node 22.19+ version and the OpenClaw npm artifact identity;
- Gateway health and authenticated protocol handshake;
- one streamed provider-broker turn with credentials retained by the host;
- constrained tool execution, history recovery, cancellation, and reconnect;
- persistent workspace restore after a document reload;
- cold-start, warm-start, transfer-size, and storage budgets;
- CSP/COOP/COEP compatibility without broad unsafe directives;
- commercial-use terms or an auditable redistribution/SBOM procedure;
- a documented exit path if a vendor service or license changes.

Provider selection and compatibility support are separate states. BrowserPod is
publicly `adopted`, while its compatibility status remains `probing` and never
becomes `supported` until these gates pass.

## Consequences

- The shipped OSS remains MIT, but optional proprietary runtimes retain their
  own terms and are never represented as MIT components.
- BrowserPod offers the shortest commercial path but introduces vendor,
  metering, privacy-policy, and availability dependencies.
- container2wasm preserves a self-hosted path but may miss acceptable download
  and startup budgets; the first Node 22 probe is already boot-blocked at
  316.7 MB before browser packaging.
- The existing WebContainer results remain reproducible evidence instead of
  being discarded or relabeled as production support.
- Remote execution cannot be used to make a failed embedded acceptance gate
  appear green.

## Sources

- [BrowserPod overview](https://browserpod.io/docs/overview)
- [BrowserPod licensing](https://browserpod.io/docs/more/licensing)
- [BrowserPod pricing](https://browserpod.io/pricing/)
- [container2wasm](https://github.com/container2wasm/container2wasm)
- [v86](https://github.com/copy/v86)
- [CheerpX overview](https://cheerpx.io/docs/overview)
- [Node 22.19 checksums](https://nodejs.org/dist/v22.19.0/SHASUMS256.txt)
