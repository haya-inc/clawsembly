# Governance

Clawsembly is currently maintained by [@yhay81](https://github.com/yhay81) on
behalf of Haya Inc. The project is in its first public prerelease and uses a
maintainer-led, evidence-first model while the runtime and security contracts
stabilize.

## Decisions

- Routine changes are decided through public issues and pull requests.
- Durable architecture or trust-boundary changes require an ADR under
  `docs/decisions/`.
- Compatibility and support claims must be generated from the exact artifact
  and reviewed by the CODEOWNER; a vote or maintainer opinion cannot turn
  missing runtime evidence green.
- Security-sensitive changes require focused failure-path tests and a review of
  credentials, identity, capabilities, audit, and teardown behavior.
- Releases follow [docs/releasing.md](docs/releasing.md) and remain prereleases
  until its evidence and external-review gates are met.

## Contributor path

Anyone may report findings, propose changes, review pull requests, or maintain a
bounded subsystem. Consistent contributors may be invited as reviewers after
demonstrating sound judgment across tests, documentation, and review. Commit
and release access is granted by the existing maintainer only after sustained
contribution and explicit agreement to the security and evidence policies.

Material governance changes are proposed through a pull request to this file.
