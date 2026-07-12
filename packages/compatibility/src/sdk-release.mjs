const PACKAGE_NAME = "@haya-inc/clawsembly";
const DOWNLOAD_BASE_URL = "https://haya-inc.github.io/clawsembly/downloads/";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function expectedTarballName(version) {
  return `haya-inc-clawsembly-${version}.tgz`;
}

export function buildSdkReleaseManifest({ sdk, tarball, checksum, report, reportSha256 }) {
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
  const tarballUrl = `${DOWNLOAD_BASE_URL}${fileName}`;
  return {
    schemaVersion: 1,
    package: { name: PACKAGE_NAME, version: sdk.version },
    distribution: {
      channel: "github-pages",
      npmPublished: false,
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
      command: `npm install ${tarballUrl}`
    }
  };
}
