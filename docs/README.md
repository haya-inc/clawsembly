# Clawsembly documentation

These documents capture the initial direction of Clawsembly. Architectural
claims are separated from dated ecosystem observations so that the durable
design does not become stale when OpenClaw changes.

## Documents

| Document | Purpose |
| --- | --- |
| [Vision](vision.md) | Product goal, principles, scope, and success criteria |
| [Prior art](prior-art.md) | Existing browser and Wasm-based Claw projects |
| [Architecture](architecture.md) | Proposed components, runtime modes, and security boundaries |
| [Upstream compatibility](upstream-compatibility.md) | How Clawsembly will follow OpenClaw releases with low maintenance cost |
| [Roadmap](roadmap.md) | Milestones and acceptance criteria for the first implementation |
| [Product](product.md) | Initial user, adoption loop, public artifacts, and success metrics |
| [OSS strategy](oss-strategy.md) | Competitive position, distribution loop, and 90-day success gates |
| [Consuming reports](consuming-reports.md) | Badge, JSON endpoints, validation policy, and trust boundary |
| [Releasing](releasing.md) | Maintainer gates for publishing, Pages setup, and prerelease evidence |
| [Risk register](risk-register.md) | Technical, platform, legal, and adoption risks with decision gates |
| [Security model](security-model.md) | Trust boundaries, assets, threats, and release requirements |
| [Deployment](deployment.md) | Required isolation headers and supported static hosts |
| [ADR 0001](decisions/0001-compatibility-lab-first.md) | Why compatibility evidence ships before a broad product UI |

## Current position

Clawsembly should be a compatibility runtime around upstream OpenClaw, not a
new implementation of OpenClaw. The architecture may evolve after the first
WebContainer compatibility probe, but the project will preserve that boundary
unless evidence shows it is unworkable.
