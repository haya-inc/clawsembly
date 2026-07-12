const PACKAGE_NAME = "@haya-inc/clawsembly";
const PAGES_MANIFEST_URL = "https://haya-inc.github.io/clawsembly/downloads/sdk-release.json";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

export function buildSourceReleaseProvenance({ tag, sourceCommit, sdkRelease, pagesManifestSha256 }) {
  const version = sdkRelease?.package?.version;
  const tarball = sdkRelease?.distribution?.tarball;
  const checksum = sdkRelease?.distribution?.checksum;
  const compatibility = sdkRelease?.compatibility;
  if (sdkRelease?.schemaVersion !== 1 || sdkRelease?.package?.name !== PACKAGE_NAME
    || tag !== `v${version}` || !COMMIT_PATTERN.test(sourceCommit ?? "")
    || sdkRelease?.distribution?.channel !== "github-pages"
    || sdkRelease?.distribution?.npmPublished !== false
    || !Number.isSafeInteger(tarball?.bytes) || tarball.bytes < 1
    || !SHA256_PATTERN.test(tarball?.sha256 ?? "")
    || checksum?.value !== tarball.sha256
    || !SHA256_PATTERN.test(compatibility?.reportSha256 ?? "")
    || !["probing", "supported", "partial", "unsupported"].includes(compatibility?.status)
    || compatibility?.reportUrl !== "https://haya-inc.github.io/clawsembly/data/compatibility.json"
    || typeof compatibility?.openclaw?.version !== "string"
    || typeof compatibility?.openclaw?.integrity !== "string"
    || compatibility?.runtime?.provider !== "browserpod"
    || typeof compatibility?.runtime?.version !== "string"
    || !SHA256_PATTERN.test(pagesManifestSha256 ?? "")) {
    throw new Error("SDK source release provenance is invalid.");
  }
  return {
    schemaVersion: 1,
    tag,
    sourceCommit,
    package: { name: PACKAGE_NAME, version },
    artifact: {
      file: tarball.file,
      bytes: tarball.bytes,
      sha256: tarball.sha256
    },
    checksum: {
      file: checksum.file,
      value: checksum.value
    },
    pagesManifest: {
      url: PAGES_MANIFEST_URL,
      sha256: pagesManifestSha256
    },
    compatibility: {
      status: compatibility.status,
      reportUrl: compatibility.reportUrl,
      reportSha256: compatibility.reportSha256,
      openclaw: compatibility.openclaw,
      runtime: compatibility.runtime
    }
  };
}

export function renderSourceReleaseNotes(provenance) {
  if (provenance?.schemaVersion !== 1 || provenance?.package?.name !== PACKAGE_NAME
    || !SHA256_PATTERN.test(provenance?.artifact?.sha256 ?? "")) {
    throw new Error("SDK source release notes require validated provenance.");
  }
  return `# Clawsembly SDK ${provenance.package.version}

This is a source SDK prerelease for external integration and contract review. It does **not** claim verified BrowserPod runtime support.

## Evidence state

- Compatibility: \`${provenance.compatibility.status}\`
- OpenClaw: \`${provenance.compatibility.openclaw.version}\`
- BrowserPod adapter: \`${provenance.compatibility.runtime.version}\`
- npm channel: published separately after this GitHub release
- Source commit: \`${provenance.sourceCommit}\`

## Install

\`\`\`sh
npm install https://github.com/haya-inc/clawsembly/releases/download/${provenance.tag}/${provenance.artifact.file}
\`\`\`

Verify the downloaded bytes against \`${provenance.checksum.file}\` before installation. The attached \`source-release.json\` binds the tag, source commit, tarball SHA-256, Pages release manifest, and exact compatibility report.

Verified launch remains fail-closed until owner-authorized BrowserPod evidence changes the bound report from \`${provenance.compatibility.status}\` to a supported result.
`;
}
