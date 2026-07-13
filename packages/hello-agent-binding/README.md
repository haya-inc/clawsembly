# hello-agent reference binding

This package is the proof for the
[upstream binding contract](../../docs/upstream-binding-contract.md) and the
demonstration vehicle for the two growth paths of
[ADR 0005](../../docs/decisions/0005-reference-agent-growth-paths.md): a
second upstream binding that composes the unmodified core, whose only way to
do chat work is through the embedder-controlled capability boundary.

## What it is

- `fixture/` - the reference upstream: `clawsembly-hello-agent`, a
  dependency-free guest program serving a bounded file-mailbox protocol
  (`clawsembly-hello/2`) whose shape mirrors the OpenClaw embedding surface:
  `hello.say` plus `chat.send`, `chat.history`, and `chat.abort` with a
  streamed delta/done event shape. Every `chat.send` completion is delegated
  to the host capability `chat.complete` through the staged, digest-pinned
  mailbox client supplied by the boundary; the agent holds no provider access
  of its own. The fixture pins Node `>=22.12.0`, below the OpenClaw baseline,
  so the full verified chain stays capturable on the Node that BrowserPod
  provisions today.
- `hello-agent-artifact.generated.mjs` - the exact npm-shaped identity of that
  fixture: name, version, SHA-512 integrity of a byte-reproducible `npm pack`
  tarball, per-file SHA-256 digests, the pinned protocol descriptor hash, its
  method list, and its declared capability requirements. Regenerate with
  `npm run hello-agent:generate`; `npm run hello-agent:check` fails the build
  when the fixture drifts from the generated pin. Growing the agent is a
  version bump plus regenerated pins - the internal growth path.
- `hello-agent-binding.mjs` - the binding: a staging installer that verifies
  every file digest before anything executes, a boot recipe with two
  deterministic readiness signals (the ready log line and a parseable session
  record naming its capability transport) supervised by the generic
  cooperative-stop machinery, a bounded protocol client pinned to the
  artifact's descriptor with a validated chat event stream and in-flight
  abort, the non-empty `HELLO_AGENT_CAPABILITY_REQUIREMENTS` declaration
  derived from the artifact itself, a digest-bound evidence gate that demands
  both denied and allowed capability outcomes, and `bootHelloAgentEmbed`,
  which assembles the session from the same core parts as the OpenClaw
  binding: `assertVerifiedLaunch`, `createBrowserPodRuntime`,
  `CapabilityBroker`, `CapabilityConsentController`,
  `FilesystemCapabilityMailboxHost`, `stageGuestMailboxClient`, and
  `createEmbedSessionLifecycle`.

## What it proves

The tests boot the staged fixture as a real Node child process behind a local
provider double that implements the documented BrowserPod 2.x surface - no
metered runtime tokens are spent. They drive the verified-report loader, the
embed manifest, the fail-closed launch assertion, and the session lifecycle
end-to-end for a package that is not OpenClaw, and they exercise the external
extension path in both directions: chat fails closed with an actionable code
while the capability is unwired or ungranted, completes through an
embedder-supplied handler after explicit approval, cancels mid-turn across
the typed mailbox, fails closed again after revocation, and never leaks chat
payloads into any audit surface.

## What it deliberately is not

- Not a real agent, and not evidence that any second agent runs. OpenClaw
  remains the only bound real upstream, and reference-agent growth stays
  bounded to what demonstrating the boundary requires.
- Not published to any registry: the fixture is `private: true`, the generated
  descriptor records `registryPublished: false`, and its identity exists only
  in this repository.
- Not covered by BrowserPod runtime evidence, and never surfaced through the
  published reports or Pages. Test evidence exercises the gate machinery; it
  is not runtime support evidence.
