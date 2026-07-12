import "./styles.css";
import { setupCredentialVault } from "./credential-vault-ui";
import { setupDeviceIdentity } from "./device-identity-ui";
import { setupLiveProvider } from "./live-provider-ui";
import { setupPermissionDemo } from "./permission-demo";

type CheckStatus = "pass" | "warn" | "fail" | "pending";

interface CompatibilityReport {
  generatedAt: string;
  status: "probing" | "supported" | "partial" | "unsupported";
  target: { browserBaseline: string };
  artifact: {
    package: string;
    version: string;
    integrity: string;
    nodeEngine: string;
    tarballBytes: number;
    unpackedBytes: number;
    directDependencyCount: number;
  };
  checks: Array<{ id: string; label: string; status: CheckStatus; detail: string }>;
}

interface ReleaseHistory {
  generatedAt: string;
  releases: Array<{
    channel: "stable" | "previous" | "preview";
    version: string;
    status: CompatibilityReport["status"];
    reportPath: string;
    runtimeEvidence: boolean;
    artifact: {
      unpackedBytes: number;
      directDependencyCount: number;
      nativeRiskCount: number;
      shrinkwrapConsistent: boolean;
    };
    checks: Record<CheckStatus, number>;
    dependencyChangesFromStable: {
      added: Array<{ name: string; spec: string }>;
      removed: Array<{ name: string; spec: string }>;
      changed: Array<{ name: string; stableSpec: string; releaseSpec: string }>;
    };
    dependencyRiskFromStable: Array<{
      name: string;
      change: "added" | "changed";
      scan: { truncated: boolean };
      signals: { browserCapabilities: string[] };
    }>;
    deltaFromStable: {
      unpackedBytes: number;
      directDependencyCount: number;
      nativeRiskCount: number;
    };
  }>;
}

const selectAll = <T extends Element>(selector: string) => Array.from(document.querySelectorAll<T>(selector));
const setText = (selector: string, value: string) => selectAll<HTMLElement>(selector).forEach((element) => { element.textContent = value; });

function formatBytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function renderChecks(checks: CompatibilityReport["checks"]): void {
  const list = document.querySelector<HTMLElement>("[data-checks]");
  if (!list) return;
  list.replaceChildren(...checks.map((check) => {
    const row = document.createElement("div");
    row.className = "check-row";
    const state = document.createElement("span");
    state.className = `check-state check-${check.status}`;
    state.setAttribute("aria-label", check.status);
    state.textContent = check.status;
    const label = document.createElement("strong");
    label.textContent = check.label;
    const detail = document.createElement("p");
    detail.textContent = check.detail;
    row.append(state, label, detail);
    return row;
  }));
}

function signed(value: number): string {
  if (value === 0) return "±0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value)}`;
}

function formatSizeDelta(bytes: number): string {
  if (bytes === 0) return "baseline";
  return `${bytes > 0 ? "+" : "−"}${(Math.abs(bytes) / 1_000_000).toFixed(1)} MB`;
}

function renderDependencyGroup(
  label: string,
  entries: Array<{ name: string; detail: string; capabilities?: string[]; truncated?: boolean }>
): HTMLElement {
  const group = document.createElement("section");
  group.className = "release-diff-group";
  const heading = document.createElement("h4");
  heading.textContent = `${label} / ${entries.length}`;
  const list = document.createElement("ol");
  if (entries.length === 0) {
    const item = document.createElement("li");
    item.className = "release-diff-empty";
    item.textContent = "No manifest changes";
    list.append(item);
  } else {
    list.append(...entries.map((entry) => {
      const item = document.createElement("li");
      const name = document.createElement("code");
      name.textContent = entry.name;
      const detail = document.createElement("span");
      detail.textContent = entry.detail;
      item.append(name, detail);
      if (entry.capabilities) {
        const signals = document.createElement("small");
        signals.className = "release-diff-signals";
        const capabilitySummary = entry.capabilities.length
          ? entry.capabilities.join(" · ")
          : "no package-level capability signal";
        signals.textContent = `${capabilitySummary}${entry.truncated ? " · scan truncated" : ""}`;
        item.append(signals);
      }
      return item;
    }));
  }
  group.append(heading, list);
  return group;
}

function renderReleaseDependencyDiff(history: ReleaseHistory): void {
  const container = document.querySelector<HTMLDetailsElement>("[data-release-diff]");
  const summary = document.querySelector<HTMLElement>("[data-release-diff-summary]");
  const list = document.querySelector<HTMLElement>("[data-release-diff-list]");
  const preview = history.releases.find((release) => release.channel === "preview");
  if (!container || !summary || !list || !preview) return;
  const changes = preview.dependencyChangesFromStable;
  const riskByName = new Map(preview.dependencyRiskFromStable.map((risk) => [risk.name, risk]));
  summary.textContent = `${changes.added.length} added · ${changes.changed.length} changed · ${changes.removed.length} removed · ${preview.dependencyRiskFromStable.length} classified`;
  const withRisk = ({ name, detail }: { name: string; detail: string }) => {
    const risk = riskByName.get(name);
    return {
      name,
      detail,
      ...(risk ? { capabilities: risk.signals.browserCapabilities, truncated: risk.scan.truncated } : {})
    };
  };
  list.replaceChildren(
    renderDependencyGroup("Added", changes.added.map(({ name, spec }) => withRisk({ name, detail: spec }))),
    renderDependencyGroup("Changed", changes.changed.map(({ name, stableSpec, releaseSpec }) => withRisk({
      name,
      detail: `${stableSpec} → ${releaseSpec}`
    }))),
    renderDependencyGroup("Removed", changes.removed.map(({ name, spec }) => ({ name, detail: spec })))
  );
  container.hidden = false;
}

function renderReleaseHistory(history: ReleaseHistory): void {
  const ledger = document.querySelector<HTMLElement>("[data-release-history]");
  if (!ledger) return;
  ledger.replaceChildren(...history.releases.map((release) => {
    const row = document.createElement("a");
    row.className = "release-row";
    row.href = `${import.meta.env.BASE_URL}data/${release.reportPath}`;
    row.setAttribute("aria-label", `${release.channel} OpenClaw ${release.version} ${release.status} report`);

    const channel = document.createElement("span");
    channel.className = `release-channel release-channel-${release.channel}`;
    channel.textContent = release.channel;

    const identity = document.createElement("div");
    identity.className = "release-identity";
    const version = document.createElement("strong");
    version.textContent = release.version;
    const evidence = document.createElement("span");
    evidence.textContent = release.runtimeEvidence ? "runtime evidenced" : "static inspection only";
    identity.append(version, evidence);

    const metrics = document.createElement("div");
    metrics.className = "release-metrics";
    const size = document.createElement("span");
    size.textContent = formatSizeDelta(release.deltaFromStable.unpackedBytes);
    const dependencies = document.createElement("span");
    dependencies.textContent = `${signed(release.deltaFromStable.directDependencyCount)} deps`;
    const native = document.createElement("span");
    native.textContent = `${signed(release.deltaFromStable.nativeRiskCount)} native risks`;
    metrics.append(size, dependencies, native);

    const checks = document.createElement("span");
    checks.className = "release-checks";
    checks.textContent = `${release.checks.pass} pass / ${release.checks.warn} warn / ${release.checks.pending} pending`;

    const status = document.createElement("span");
    status.className = `release-state release-state-${release.status}`;
    status.textContent = release.status;

    const arrow = document.createElement("span");
    arrow.className = "release-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↗";
    row.append(channel, identity, metrics, checks, status, arrow);
    return row;
  }));

  setText("[data-release-generated]", new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(history.generatedAt)));
  const indexLink = document.querySelector<HTMLAnchorElement>("[data-release-index]");
  if (indexLink) indexLink.href = `${import.meta.env.BASE_URL}data/release-history.json`;
  renderReleaseDependencyDiff(history);
}

async function loadReleaseHistory(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/release-history.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Release history request failed: ${response.status}`);
  renderReleaseHistory(await response.json() as ReleaseHistory);
}

async function loadReport(): Promise<void> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/compatibility.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Compatibility report request failed: ${response.status}`);
  const report = await response.json() as CompatibilityReport;
  document.documentElement.dataset.openclawVersion = report.artifact.version;
  document.documentElement.dataset.openclawIntegrity = report.artifact.integrity;

  setText("[data-package]", report.artifact.package);
  setText("[data-version]", report.artifact.version);
  setText("[data-status]", report.status.toUpperCase());
  setText("[data-node-engine]", report.artifact.nodeEngine);
  setText("[data-tarball]", formatBytes(report.artifact.tarballBytes));
  setText("[data-unpacked]", formatBytes(report.artifact.unpackedBytes));
  setText("[data-dependencies]", String(report.artifact.directDependencyCount));
  setText("[data-browser-baseline]", report.target.browserBaseline);
  setText("[data-generated]", new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.generatedAt)));
  const statusLight = document.querySelector<HTMLElement>(".status-light");
  if (statusLight) {
    statusLight.classList.remove("status-probing", "status-supported", "status-partial", "status-unsupported");
    statusLight.classList.add(`status-${report.status}`);
  }
  renderChecks(report.checks);
}

function setupReveal(): void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.18 });
  selectAll(".reveal").forEach((element) => observer.observe(element));
}

function setupScrollProgress(): void {
  const progress = document.querySelector<HTMLElement>(".scroll-progress");
  if (!progress) return;
  const update = () => {
    const available = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${available > 0 ? window.scrollY / available : 0})`;
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
}

function setupOrbit(): void {
  const orbit = document.querySelector<HTMLElement>("[data-orbit]");
  if (!orbit || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.addEventListener("pointermove", (event) => {
    const x = (event.clientX / window.innerWidth - 0.5) * 8;
    const y = (event.clientY / window.innerHeight - 0.5) * -8;
    orbit.style.setProperty("--tilt-x", `${y}deg`);
    orbit.style.setProperty("--tilt-y", `${x}deg`);
  }, { passive: true });
}

function setupCopyButton(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-copy-report]");
  button?.addEventListener("click", async () => {
    const url = new URL(`${import.meta.env.BASE_URL}data/compatibility.json`, window.location.href).toString();
    if (button.dataset.mode === "open") {
      window.open(url, "_blank", "noopener");
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = url;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      copied = document.execCommand("copy");
      fallback.remove();
    }
    button.textContent = copied ? "Copied" : "Open report";
    if (!copied) button.dataset.mode = "open";
    if (copied) window.setTimeout(() => { button.textContent = "Copy report URL"; }, 1600);
  });
}

loadReport().then(() => {
  setupPermissionDemo();
}).catch((error: unknown) => {
  setText("[data-status]", "REPORT ERROR");
  const list = document.querySelector<HTMLElement>("[data-checks]");
  if (list) list.textContent = error instanceof Error ? error.message : "Unable to load compatibility evidence.";
}).finally(() => {
  setupCredentialVault();
  setupLiveProvider();
  setupDeviceIdentity();
});
loadReleaseHistory().catch((error: unknown) => {
  const ledger = document.querySelector<HTMLElement>("[data-release-history]");
  if (ledger) ledger.textContent = error instanceof Error ? error.message : "Unable to load release history.";
});
setupReveal();
setupScrollProgress();
setupOrbit();
setupCopyButton();
