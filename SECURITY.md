# Security policy

Clawsembly is pre-release software and is not yet suitable for protecting
production credentials or sensitive workspaces.

## Reporting a vulnerability

Do not open a public issue for vulnerabilities involving credential exposure,
identity reuse, sandbox escape, network-policy bypass, report tampering, or a
native Gateway authentication bypass.

Use GitHub private vulnerability reporting for this repository. Include the
affected commit or version, browser and operating system, a minimal reproduction,
impact, and any known workaround. Maintainers will acknowledge a complete report
within five business days and coordinate disclosure after a fix is available.

## Supported versions

Only the latest source prerelease and the current default branch receive
security fixes. Older prereleases are unsupported after a replacement ships.

| Version | Security fixes |
| --- | --- |
| `0.1.0-alpha.2` | Yes |
| `0.1.0-alpha.1` and older or untagged source archives | No |

This policy covers defects in the SDK, evidence pipeline, capability boundary,
and release artifacts. It does not make the current `probing` BrowserPod result
suitable for production credentials or sensitive workspaces.
