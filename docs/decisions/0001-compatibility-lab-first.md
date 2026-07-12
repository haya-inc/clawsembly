# ADR 0001: Ship the compatibility lab before the broad product UI

- Status: accepted
- Date: 2026-07-12

## Context

Clawsembly depends on a large, rapidly changing upstream package and on a
browser-hosted Node runtime with platform constraints. A polished UI cannot
prove that the current upstream release boots safely or that disabled
capabilities fail clearly.

## Decision

The first public implementation is a versioned compatibility-report schema,
static npm artifact inspector, report-driven project page, and runtime-probe
harness. The embedded chat product follows only after boot and Gateway handshake
evidence exists.

## Consequences

- The project delivers useful public data even when a runtime probe fails.
- Contributors can work on bounded fixtures and classifications.
- Automated upstream tracking begins before product breadth.
- The first page may show `probing` or `unsupported`; this is honest product
  behavior, not a launch failure.
