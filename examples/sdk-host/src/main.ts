import type { CompatibilityReportInput } from "@haya-inc/clawsembly";
import { inspectLaunchReport, type LaunchDecision } from "./launch-decision";
import "./styles.css";

const REPORT_URL = "https://haya-inc.github.io/clawsembly/data/compatibility.json";

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing host element: ${selector}`);
  return element;
}

function setText(selector: string, value: string): void {
  required<HTMLElement>(selector).textContent = value;
}

function renderDecision(decision: LaunchDecision): void {
  const { manifest } = decision;
  document.documentElement.dataset.decision = decision.state;
  setText("[data-decision-title]", decision.state === "ready" ? "Evidence accepted" : "Provider boot blocked");
  setText("[data-decision-summary]", decision.summary);
  setText("[data-decision-state]", decision.state);
  setText("[data-package]", manifest.artifact.package);
  setText("[data-version]", manifest.artifact.version);
  setText("[data-integrity]", manifest.artifact.integrity);
  setText("[data-runtime]", `${manifest.runtime}@${manifest.runtimeVersion}`);
  setText("[data-report-status]", manifest.evidence.reportStatus);
  setText("[data-generated]", new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(manifest.evidence.generatedAt)));
  setText("[data-provider-state]", "Not attempted");

  const blockers = required<HTMLOListElement>("[data-blockers]");
  const descriptions = manifest.blockers.length > 0
    ? manifest.blockers
    : ["No evidence blockers. Continue only through an explicit owner-controlled integration."];
  blockers.replaceChildren(...descriptions.map((description) => {
    const item = document.createElement("li");
    item.textContent = description;
    return item;
  }));
}

function renderFailure(): void {
  document.documentElement.dataset.decision = "error";
  setText("[data-decision-title]", "Report unavailable");
  setText("[data-decision-summary]", "The launch decision could not be verified. Provider boot remains blocked.");
  setText("[data-decision-state]", "error");
  setText("[data-provider-state]", "Not attempted");
  const blockers = required<HTMLOListElement>("[data-blockers]");
  const item = document.createElement("li");
  item.textContent = "A current, valid compatibility report is required.";
  blockers.replaceChildren(item);
}

async function refresh(): Promise<void> {
  const button = required<HTMLButtonElement>("[data-refresh]");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  document.documentElement.dataset.decision = "checking";
  setText("[data-decision-state]", "checking");
  try {
    const response = await fetch(REPORT_URL, { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("report request failed");
    renderDecision(inspectLaunchReport(await response.json() as CompatibilityReportInput));
  } catch {
    renderFailure();
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
}

required<HTMLAnchorElement>("[data-report-link]").href = REPORT_URL;
required<HTMLButtonElement>("[data-refresh]").addEventListener("click", () => { void refresh(); });
void refresh();
