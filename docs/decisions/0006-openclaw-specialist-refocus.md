# ADR 0006: OpenClaw-specialist refocus

- Status: accepted
- Date: 2026-07-22
- Amends: [ADR 0004](0004-upstream-portable-embedding-boundary.md)

## Context

ADR 0004 repositioned OpenClaw from project identity to first bound upstream
and treated multi-upstream portability as a product commitment whose next
steps were the documented upstream-binding contract and, later, additional
real bindings. Since then the measured situation has changed:

- **The boundary is proven on the real provider; the flagship path is not.**
  The hello-agent reference chain holds one owner-authorized runtime record
  on `browserpod@2.12.1` plus a performance baseline
  ([#48](https://github.com/haya-inc/clawsembly/pull/48),
  [#53](https://github.com/haya-inc/clawsembly/pull/53)). Verified OpenClaw
  boot remains blocked by two vendor gaps this repository cannot close: the
  BrowserPod guest provisions Node 22.15.0 while current stable
  `openclaw@2026.7.1-2` declares
  `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`
  ([#6](https://github.com/haya-inc/clawsembly/issues/6)), and the guest
  Node build ships no `node:sqlite` binding at all, which the tracked and
  pinned releases hard-require — verified for `2026.5.7` and `2026.7.1-2`
  ([#47](https://github.com/haya-inc/clawsembly/issues/47), reproduced on
  BrowserPod 2.12.1 and 2.14.0). The Node-floor gap is widening, not
  closing.
- **Upstream velocity is the operator's problem, and this repository
  already measures it.** The tracked contract diff shows preview
  `2026.7.2-beta.3` removing the entire 32-method `skills.*` surface —
  including its security-verdict and quarantine methods — in favor of
  `plugins.*`, while adding 62 core methods across approvals, session
  catalogs, environments, worktrees, and an MCP app surface. Everyone
  operating or embedding upstream OpenClaw absorbs this churn release by
  release.
- **A second-upstream candidate survey was completed and set aside.** A
  2026-07-22 registry-metadata survey identified viable non-OpenClaw
  candidates for the binding contract. The owner decided that direction
  belongs in separate projects: this repository targets OpenClaw's market
  specifically.

## Decision

This repository specializes in OpenClaw. OpenClaw is the project identity
here, not merely the first bound upstream; other upstreams are out of scope
and belong to separate projects.

1. **The product direction is wrapping upstream OpenClaw** with the
   conveniences its operators and embedders need, in this order:
   1. a **native-Gateway evidence lane**: install the exact stable artifact
      on a plain Node runner that satisfies its engines declaration, boot
      the real Gateway, and exercise the generated protocol client against
      it. Recorded as a distinct native-mode evidence class that never
      satisfies, implies, or promotes BrowserPod runtime support;
   2. a **remote-mode embedding surface** ("connect your OpenClaw"): the
      implemented browser device identity, pairing review, encrypted token
      vault, and bounded chat client offered against a user-operated native
      Gateway, behind the same default-deny broker and payload-free audit;
   3. **release intelligence for operators** — the promotion policy,
      contract diffs, and dependency-risk scans translated into upgrade
      advisories — retained as supporting trust infrastructure, not the
      product;
   4. an exploration of **extension vetting**: applying the no-execution
      dependency scanner to the upstream plugin ecosystem while its
      skills-to-plugins migration is in flight.
2. **Browser-local OpenClaw on BrowserPod remains the flagship
   deliverable** and stays vendor-gated. ADR 0002's acceptance gates and
   ADR 0003's evidence rules are unchanged; the capture harness stays
   ready, and no new effort is spent against the vendor gaps beyond
   tracking them.
3. **The upstream-portable boundary remains an engineering property, not a
   roadmap.** The upstream-binding contract and the hello-agent reference
   binding (ADR 0005) are retained as the test infrastructure that keeps
   the embedding core honest; no second real binding is planned in this
   repository.
4. **Communication stays low-key.** Coordinated promotion is deferred until
   the first genuinely useful wrap deliverable exists; checked-in artifacts
   and documentation remain the discovery surface.

Honesty constraints on all resulting claims: nothing states or implies
OpenClaw affiliation or endorsement; native-mode evidence and BrowserPod
evidence are separate classes and neither stands in for the other; all
published browser-runtime reports remain `probing` until owner-authorized
BrowserPod evidence exists; remote mode is interoperability and cannot
satisfy the browser-local acceptance gates (ADR 0002).

## Consequences

- README (English and Japanese), the documentation index, vision, product,
  OSS strategy, roadmap, and the upstream-binding contract are aligned with
  the specialist framing in the change set that lands this ADR.
- ADR 0004 is amended: its moat analysis — browser-local execution plus the
  embedder-controlled boundary — stands, while its decision to avoid an
  OpenClaw-only identity is superseded for this repository.
- The roadmap gains a dated refocus execution plan ordering the four wrap
  deliverables above.
- Project-page messaging still reflects the ADR 0004 framing; realigning it
  moves browser-test text assertions and is deferred to its own change.
- Accepted risks: the project couples to a single upstream that could ship
  an official browser story or re-license — the pre-committed responses in
  the OSS strategy's upstream scenarios continue to apply. The ADR 0004
  concern that the claw-family name under-describes the scope dissolves:
  the name now describes the scope.

## Alternatives considered

1. **Bind a second real upstream now** (the surveyed candidate direction).
   Rejected for this repository: it dilutes the OpenClaw-market focus the
   owner chose. The survey material remains usable in a separate project.
2. **Wait for the vendor gaps to close before adding product surface.**
   Rejected: both gaps are outside this repository's control and the
   Node-floor gap is widening; the native-Gateway lane and remote mode
   deliver verifiable OpenClaw value without the vendor.

## Related decisions

- ADR 0002 keeps execution browser-local and defines the BrowserPod
  acceptance gates; remote mode remains interoperability, not a
  replacement.
- ADR 0003 defined verified OpenClaw embedding; its evidence rules govern
  the new native-mode class as strictly as the browser-local one.
- ADR 0004 identified the durable value; this ADR narrows its
  multi-upstream product commitment to an engineering property.
- ADR 0005 keeps the hello-agent reference binding as the boundary's test
  instrument.
