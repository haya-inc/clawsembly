# Clawsembly promotion-policy Action

Use the public OpenClaw promotion decision without installing Clawsembly or
providing BrowserPod/provider credentials.

```yaml
jobs:
  openclaw-policy:
    runs-on: ubuntu-latest
    steps:
      - id: clawsembly
        uses: haya-inc/clawsembly/actions/promotion-policy@main
        with:
          mode: observe
      - run: echo "${{ steps.clawsembly.outputs.decision }}"
```

`observe` reports either result successfully. `gate` exits nonzero unless the
validated candidate is `promote`. Pin a reviewed commit SHA instead of the
moving development branch for production use.

Outputs:

- `decision`: `promote` or `hold`;
- `candidate_version`: exact preview version;
- `reasons`: comma-separated blocker identifiers.

The action runs on Node 24 and has no package dependencies. Its consumer rejects
redirects, credential-bearing or aliased URLs, non-JSON responses, bodies over
1 MiB, malformed observations, unknown blocker identifiers, and contradictions
between observations, reasons, eligibility, and the top-level decision.
