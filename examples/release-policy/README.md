# Release promotion policy consumer

This dependency-free Node.js example consumes Clawsembly's public promotion
policy and fails closed when the latest OpenClaw preview is not eligible for
promotion. It does not boot BrowserPod or contact a model provider.

```bash
# Observation mode prints the decision without failing the job.
node examples/release-policy/check.mjs --observe

# Gate mode exits nonzero unless the candidate decision is "promote".
node examples/release-policy/check.mjs
```

The current public policy is expected to return `HOLD`: runtime evidence is
missing, checks remain pending, the published shrinkwrap is inconsistent, and
the preview Gateway contract is classified breaking. This is the useful
result—an integration should not silently promote that candidate.

Copy `check.mjs` into a downstream repository or use the workflow template in
this directory. Set `CLAWSEMBLY_POLICY_URL` only to another credential-free
HTTPS mirror of the same schema. The consumer rejects redirects, query/fragment
aliases, non-JSON responses, bodies over 1 MiB, unknown reason identifiers, and
decision/gate contradictions.

For strict schema validation, use the public
[`promotion-policy.schema.json`](https://haya-inc.github.io/clawsembly/schemas/promotion-policy.schema.json).
