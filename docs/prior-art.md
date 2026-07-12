# Prior-art survey

Survey date: 2026-07-12.

GitHub showed 516 stars / 91 forks for ClawLess, 597 / 83 for
OpenBrowserClaw, 2 / 0 for ShadowClaw, and 12.4k / 1.4k for IronClaw on the
survey date. These are dated distribution signals rather than quality scores.
They suggest that a simple product promise, a usable artifact, and a distinct
security or architecture story matter more for discovery than implementation
depth alone. See the resulting [OSS success strategy](oss-strategy.md).

No surveyed project currently combines all four target properties:

1. running in a browser or Wasm-based environment;
2. using the upstream OpenClaw runtime rather than a rewrite;
3. continuously tracking current OpenClaw releases with automated tests.
4. binding exact runtime evidence to a default-deny, host-owned capability
   contract that another web application can embed.

## ClawLess

[ClawLess](https://github.com/open-gitagent/clawless) is the closest technical
precedent. It installs an upstream `openclaw` npm package inside a StackBlitz
WebContainer, disables native dependencies with npm overrides and loader hooks,
starts the Gateway, and supplies a custom HTTP chat TUI.

Its OpenClaw integration demonstrates that this approach can boot, but it is a
point-in-time proof of concept:

- the template pins OpenClaw `2026.3.13`;
- native packages are replaced with a generic dummy package;
- WebContainer crypto limitations are worked around with a shared static
  Ed25519 identity;
- the standard Control UI is replaced because its WebSocket authentication
  path did not work in that environment;
- the project has no automated tests for the OpenClaw template.

The implementation and its known limitations are documented in
[ClawLess PR #9](https://github.com/open-gitagent/clawless/pull/9).

### Lessons for Clawsembly

- Reuse the upstream package, but replace ad hoc stubs with explicit,
  fail-closed capability adapters.
- Generate a unique identity outside the WebContainer and inject only the
  required key material.
- Test the official Gateway protocol instead of relying on startup log text.
- Treat every upstream version as a compatibility target, not as a manual
  dependency bump.

## OpenBrowserClaw

[OpenBrowserClaw](https://github.com/wexare-ai/openbrowserclaw) is a small
browser-native personal-agent proof of concept. It uses IndexedDB, the Origin
Private File System (OPFS), a Web Worker, and an optional v86 Alpine Linux
virtual machine compiled to WebAssembly.

It implements its own Anthropic tool loop and does not reuse the OpenClaw
Gateway or protocol. Its storage and browser-isolation choices are useful
references, but using it as the base would turn Clawsembly into another
OpenClaw-inspired rewrite.

## ShadowClaw

[ShadowClaw](https://github.com/xt-ml/shadow-claw) is an active browser-native
descendant of OpenBrowserClaw. It has expanded provider support, OPFS-backed
Git, remote MCP, messaging channels, WebVM integration, multi-agent features,
and a substantial test suite.

ShadowClaw is the strongest reference for browser-native product behavior and
storage ergonomics. It remains an independent runtime, so it does not inherit
OpenClaw behavior or updates automatically.

## IronClaw

[IronClaw](https://github.com/nearai/ironclaw) is a Rust reimplementation with
Wasmtime-based tools and channels. It demonstrates a capability-oriented Wasm
extension system and keeps an explicit
[OpenClaw feature-parity matrix](https://github.com/nearai/ironclaw/blob/main/FEATURE_PARITY.md).

Its architecture is relevant to Clawsembly's extension boundary. Its parity
matrix also illustrates the cost of following a fast-moving upstream through
manual feature reimplementation.

## Relevant platform projects

- [WebContainers](https://webcontainers.io/) provide the browser-hosted
  Node-compatible runtime used by ClawLess. Native addons cannot run unless
  they are implemented for WebAssembly, as described in the
  [WebContainers troubleshooting guide](https://webcontainers.io/guides/troubleshooting).
- [BrowserPod](https://browserpod.io/docs/overview) runs Node 22 inside the
  browser with a virtual filesystem and controlled service portals. Its paid
  plans explicitly allow commercial use. Clawsembly adopts it as the first
  embedded provider, but the runtime is proprietary, metered, and vendor-hosted
  unless separately licensed for self-hosting.
- [container2wasm](https://github.com/container2wasm/container2wasm) converts
  amd64 containers into browser-runnable Wasm using emulation. It offers an open
  self-distribution path but remains experimental and generated artifacts carry
  emulator, Linux, and guest-package licensing obligations. Clawsembly's pinned
  Node 22 probe generated a 316.7 MB module and failed before the guest command,
  so the path is archived rather than treated as an active runtime alternative.
- [v86](https://github.com/copy/v86) is BSD-licensed and browser-local, but it
  does not support 64-bit kernels. Current
  [CheerpX](https://cheerpx.io/docs/overview) likewise documents 32-bit x86.
  Neither can host the official Node 22 Linux x64 artifact required here.
- [The WebAssembly Component Model](https://component-model.bytecodealliance.org/)
  provides typed WIT interfaces suitable for future capability modules.
- [Node.js WASI](https://nodejs.org/api/wasi.html) lets Node host Wasm modules;
  it does not compile a Node application into a standalone Wasm module.

## Conclusion

Clawsembly should combine the upstream-package strategy proven by ClawLess,
the browser storage patterns explored by ShadowClaw, and the explicit Wasm
capability boundaries demonstrated by IronClaw. Its distinct contribution is
to make those boundaries evidence-bound and reusable by embedding applications.
It should not inherit manual version pins or independent agent implementations.
