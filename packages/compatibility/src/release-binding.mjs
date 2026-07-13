// Pure assertions binding the deployed SDK release manifest to the reviewed
// npm publication record and the exact distributed bytes. release-readiness
// runs them against dist/; unit tests exercise them against fixtures so the
// final release gate is no longer test-free.
import { createHash } from "node:crypto";

export function assertSdkReleaseBinding({
  sdkRelease,
  npmPublication,
  sdkTarballBytes,
  sdkPackageVersion,
  checksumFileText
}) {
  const sdkTarballFile = `haya-inc-clawsembly-${sdkPackageVersion}.tgz`;
  const sdkTarballName = sdkRelease.distribution?.tarball?.file;
  if (sdkRelease.schemaVersion !== 1 || sdkRelease.package?.name !== "@haya-inc/clawsembly"
    || sdkRelease.package?.version !== sdkPackageVersion
    || sdkRelease.distribution?.npmPublished !== (npmPublication.status === "published")
    || sdkTarballName !== sdkTarballFile) {
    throw new Error("The Pages SDK release manifest misidentifies the reviewed publication state.");
  }
  const sha256 = createHash("sha256").update(sdkTarballBytes).digest("hex");
  if (sha256 !== sdkRelease.distribution.tarball.sha256
    || sdkTarballBytes.byteLength !== sdkRelease.distribution.tarball.bytes) {
    throw new Error("The Pages SDK tarball bytes do not match the release manifest.");
  }
  const integrity = `sha512-${createHash("sha512").update(sdkTarballBytes).digest("base64")}`;
  if (npmPublication.status === "published") {
    if (npmPublication.integrity !== integrity) {
      throw new Error("The npm publication record integrity does not match the deployed SDK bytes.");
    }
    if (sdkRelease.distribution.npm?.integrity !== integrity
      || sdkRelease.install?.command !== `npm install @haya-inc/clawsembly@${sdkPackageVersion}`) {
      throw new Error("The published npm record is not bound to the deployed SDK bytes.");
    }
  } else if (sdkRelease.distribution.npm !== undefined
    || sdkRelease.install?.command !== `npm install ${sdkRelease.distribution?.tarball?.url}`) {
    throw new Error("The pending npm record must keep installation on the verified Pages tarball.");
  }
  if (checksumFileText !== undefined) {
    if (sdkRelease.distribution.checksum?.file !== `${sdkTarballFile}.sha256`
      || sdkRelease.distribution.checksum?.value !== sha256
      || checksumFileText !== `${sha256}  ${sdkTarballName}\n`) {
      throw new Error("The Pages SDK checksum does not match the release tarball.");
    }
  }
  return Object.freeze({ sha256, integrity, tarballFile: sdkTarballFile });
}

export function assertCompatibilityReportBinding({ sdkRelease, publicReportText }) {
  const reportSha256 = createHash("sha256").update(publicReportText).digest("hex");
  if (reportSha256 !== sdkRelease.compatibility?.reportSha256) {
    throw new Error("The Pages SDK release is not bound to the deployed compatibility report.");
  }
  const deployedReport = JSON.parse(publicReportText);
  if (sdkRelease.compatibility.status !== deployedReport.status
    || sdkRelease.compatibility.openclaw.version !== deployedReport.artifact.version
    || sdkRelease.compatibility.openclaw.integrity !== deployedReport.artifact.integrity
    || sdkRelease.compatibility.runtime.provider !== deployedReport.target.runtime
    || sdkRelease.compatibility.runtime.version !== deployedReport.target.runtimeVersion) {
    throw new Error("The Pages SDK release compatibility identity drifted from its deployed report.");
  }
  return Object.freeze({ reportSha256 });
}

export function localMarkdownTargets(source) {
  const targets = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    const raw = match[1].trim().replace(/^<|>$/g, "").split(/\s+["']/)[0];
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    targets.push(decodeURIComponent(raw.split("#")[0]));
  }
  return targets;
}
