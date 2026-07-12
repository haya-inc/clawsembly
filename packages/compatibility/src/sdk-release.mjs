const PACKAGE_NAME = "@haya-inc/clawsembly";
const DOWNLOAD_BASE_URL = "https://haya-inc.github.io/clawsembly/downloads/";
const NPM_REGISTRY_URL = "https://registry.npmjs.org/";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHA512_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const PROVENANCE_URL_PATTERN = /^https:\/\/search\.sigstore\.dev\/\?logIndex=[0-9]+$/u;

function expectedTarballName(version) {
  return `haya-inc-clawsembly-${version}.tgz`;
}

function npmDistribution(publication, sdk, tarball) {
  if (publication?.schemaVersion !== 1
    || publication?.package?.name !== PACKAGE_NAME
    || publication?.package?.version !== sdk.version
    || Object.keys(publication?.package ?? {}).sort().join(",") !== "name,version"
    || publication?.registry !== NPM_REGISTRY_URL
    || publication?.distTag !== "alpha"
    || !["pending", "published"].includes(publication?.status)) {
    throw new Error("npm publication record is invalid.");
  }
  if (publication.status === "pending") {
    if (Object.keys(publication).sort().join(",") !== "distTag,package,registry,schemaVersion,status") {
      throw new Error("pending npm publication record contains unverified fields.");
    }
    return { published: false };
  }
  if (publication.integrity !== tarball.integrity
    || !SHA512_INTEGRITY_PATTERN.test(publication.integrity ?? "")
    || !PROVENANCE_URL_PATTERN.test(publication.provenanceUrl ?? "")
    || !Number.isFinite(Date.parse(publication.publishedAt ?? ""))
    || new Date(publication.publishedAt).toISOString() !== publication.publishedAt) {
    throw new Error("published npm record is not bound to the SDK tarball and provenance.");
  }
  if (Object.keys(publication).sort().join(",") !== "distTag,integrity,package,provenanceUrl,publishedAt,registry,schemaVersion,status") {
    throw new Error("published npm publication record contains unverified fields.");
  }
  return {
    published: true,
    record: {
      registry: NPM_REGISTRY_URL,
      packageUrl: `https://www.npmjs.com/package/${PACKAGE_NAME}/v/${sdk.version}`,
      distTag: "alpha",
      integrity: publication.integrity,
      publishedAt: publication.publishedAt,
      provenanceUrl: publication.provenanceUrl
    }
  };
}

export function buildSdkReleaseManifest({ sdk, tarball, checksum, report, reportSha256, publication }) {
  if (sdk?.name !== PACKAGE_NAME || !/^0\.1\.0-alpha\.[0-9]+$/u.test(sdk?.version ?? "")
    || sdk?.private !== false) {
    throw new Error("SDK release identity is invalid.");
  }
  const fileName = expectedTarballName(sdk.version);
  if (tarball?.file !== fileName || !Number.isSafeInteger(tarball?.bytes) || tarball.bytes < 1
    || !SHA256_PATTERN.test(tarball?.sha256 ?? "")) {
    throw new Error("SDK tarball release record is invalid.");
  }
  const checksumFile = `${fileName}.sha256`;
  if (checksum?.file !== checksumFile || checksum?.value !== tarball.sha256
    || !Number.isSafeInteger(checksum?.bytes) || checksum.bytes < 1) {
    throw new Error("SDK checksum release record is invalid.");
  }
  if (report?.schemaVersion !== 1 || report?.artifact?.package !== "openclaw"
    || typeof report?.artifact?.version !== "string" || typeof report?.artifact?.integrity !== "string"
    || report?.target?.runtime !== "browserpod" || typeof report?.target?.runtimeVersion !== "string"
    || !["probing", "supported", "partial", "unsupported"].includes(report?.status)
    || !SHA256_PATTERN.test(reportSha256 ?? "")) {
    throw new Error("SDK release compatibility binding is invalid.");
  }
  const npm = npmDistribution(publication, sdk, tarball);
  const tarballUrl = `${DOWNLOAD_BASE_URL}${fileName}`;
  return {
    schemaVersion: 1,
    package: { name: PACKAGE_NAME, version: sdk.version },
    distribution: {
      channel: "github-pages",
      npmPublished: npm.published,
      ...(npm.record ? { npm: npm.record } : {}),
      tarball: { file: fileName, url: tarballUrl, bytes: tarball.bytes, sha256: tarball.sha256 },
      checksum: {
        file: checksumFile,
        url: `${DOWNLOAD_BASE_URL}${checksumFile}`,
        bytes: checksum.bytes,
        value: checksum.value
      }
    },
    compatibility: {
      status: report.status,
      reportUrl: "https://haya-inc.github.io/clawsembly/data/compatibility.json",
      reportSha256,
      openclaw: {
        version: report.artifact.version,
        integrity: report.artifact.integrity
      },
      runtime: {
        provider: "browserpod",
        version: report.target.runtimeVersion
      }
    },
    install: {
      command: npm.published
        ? `npm install ${PACKAGE_NAME}@${sdk.version}`
        : `npm install ${tarballUrl}`
    }
  };
}
