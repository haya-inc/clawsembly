# hello-agent reference binding

This package is the proof for the
[upstream binding contract](../../docs/upstream-binding-contract.md): a second
upstream binding that composes the unmodified core, so upstream portability is
a demonstrated property instead of a stated one.

## What it is

- `fixture/` - the trivial upstream: `clawsembly-hello-agent`, a dependency-free
  guest program that serves exactly one protocol method (`hello.say`) over a
  bounded file mailbox, plus its one-method protocol descriptor.
- `hello-agent-artifact.generated.mjs` - the exact npm-shaped identity of that
  fixture: name, version, SHA-512 integrity of a byte-reproducible `npm pack`
  tarball, per-file SHA-256 digests, and the pinned protocol descriptor hash.
  Regenerate with `npm run hello-agent:generate`; `npm run hello-agent:check`
  fails the build when the fixture drifts from the generated pin.
- `hello-agent-binding.mjs` - the binding: a staging installer that verifies
  every file digest before anything executes, a boot recipe with two
  deterministic readiness signals (the ready log line and a parseable session
  record) supervised by the generic cooperative-stop machinery, a bounded
  one-method protocol client pinned to the artifact's descriptor, an explicit
  empty capability-requirement declaration, a minimal digest-bound evidence
  gate, and `bootHelloAgentEmbed`, which assembles the session from the same
  core parts as the OpenClaw binding: `assertVerifiedLaunch`,
  `createBrowserPodRuntime`, `CapabilityBroker`, `CapabilityConsentController`,
  and `createEmbedSessionLifecycle`.

## What it proves

The tests boot the staged fixture as a real Node child process behind a local
provider double that implements the documented BrowserPod 2.x surface - no
metered runtime tokens are spent. They drive the verified-report loader, the
embed manifest, the fail-closed launch assertion, the broker, and the session
lifecycle end-to-end for a package that is not OpenClaw.

## What it deliberately is not

- Not a real agent, and not evidence that any second agent runs. OpenClaw
  remains the only bound real upstream.
- Not published to any registry: the fixture is `private: true`, the generated
  descriptor records `registryPublished: false`, and its identity exists only
  in this repository.
- Not covered by BrowserPod runtime evidence, and never surfaced through the
  published reports or Pages. Test evidence exercises the gate machinery; it
  is not runtime support evidence.
