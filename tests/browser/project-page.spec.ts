import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const sdkVersion = JSON.parse(readFileSync("packages/sdk-package/package.json", "utf8")).version as string;
const npmPublication = JSON.parse(readFileSync("packages/compatibility/npm-publication.json", "utf8")) as { status: "pending" | "published" };

test("project page distinguishes stable, previous, and preview evidence", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const indexResponse = await request.get("/data/release-history.json");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json() as {
    channels: Record<string, string>;
    releases: Array<{
      channel: string;
      version: string;
      runtimeEvidence: boolean;
      deltaFromStable: { directDependencyCount: number };
      dependencyChangesFromStable: {
        added: Array<{ name: string; spec: string }>;
        removed: Array<{ name: string; spec: string }>;
        changed: Array<{ name: string; stableSpec: string; releaseSpec: string }>;
      };
      dependencyRiskFromStable: Array<{
        name: string;
        scan: { truncated: boolean };
        signals: { browserCapabilities: string[] };
      }>;
      gatewayContractFromStable: {
        classification: string;
        protocol: {
          stable: { current: number | null; minClient: number | null; minProbe: number | null; minNode: number | null };
          release: { current: number | null; minClient: number | null; minProbe: number | null; minNode: number | null };
        };
        distribution: { legacyPluginDeclarationCount: { stable: number; release: number; delta: number } };
        coreMethods: { added: string[]; removed: string[] };
        schemaExports: { added: string[]; removed: string[] };
      };
    }>;
  };
  expect(index.releases.map((release) => release.channel)).toEqual(["stable", "previous", "preview"]);
  expect(new Set(Object.values(index.channels)).size).toBe(3);
  const policyResponse = await request.get("/data/promotion-policy.json");
  expect(policyResponse.ok()).toBe(true);
  const policy = await policyResponse.json() as {
    schemaVersion: number;
    decision: "promote" | "hold";
    candidate: { channel: string; version: string; eligible: boolean; reasons: string[] };
  };
  expect(policy.schemaVersion).toBe(1);
  expect(policy.candidate.eligible).toBe(policy.decision === "promote");

  const pageResponse = await request.get("/");
  expect(pageResponse.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(pageResponse.headers()["content-security-policy"]).not.toContain("stackblitz.com");
  expect(pageResponse.headers()["content-security-policy"]).toContain("connect-src 'self' https://api.openai.com");
  expect(pageResponse.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(pageResponse.headers()["x-content-type-options"]).toBe("nosniff");

  await page.goto("/#releases");
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute("content", /script-src 'self' 'sha256-/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://haya-inc.github.io/clawsembly/");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://haya-inc.github.io/clawsembly/social-preview.png");
  const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "null") as {
    "@type"?: string;
    codeRepository?: string;
  };
  expect(structuredData).toMatchObject({
    "@type": "SoftwareSourceCode",
    codeRepository: "https://github.com/haya-inc/clawsembly"
  });
  const previewResponse = await request.get("/social-preview.png");
  expect(previewResponse.ok()).toBe(true);
  expect(previewResponse.headers()["content-type"]).toContain("image/png");
  const history = page.locator("[data-release-history]");
  await expect(history.locator(".release-row")).toHaveCount(3);
  for (const release of index.releases) {
    await expect(history.getByText(release.version, { exact: true })).toBeVisible();
  }
  const evidencedCount = index.releases.filter((release) => release.runtimeEvidence).length;
  await expect(history.getByText("runtime evidenced", { exact: true })).toHaveCount(evidencedCount);
  await expect(history.getByText("static inspection only", { exact: true })).toHaveCount(3 - evidencedCount);
  const broker = page.locator("#broker");
  await expect(broker.getByRole("heading", { name: "Runtime is commodity. Authority is not." })).toBeVisible();
  await expect(broker.locator(".broker-gate strong")).toHaveText(/DEFAULT\s*DENY/);
  await expect(broker.getByText("pending exact request", { exact: true })).toBeVisible();
  await expect(page.getByText("pending · approve · expire/revoke", { exact: true })).toBeVisible();
  await expect(page.locator("[data-probe-output] li")).toHaveCount(8);
  await expect(page.getByText("manifest + lock integrity readback", { exact: true })).toBeVisible();
  await expect(page.getByText("token-private · origin-pinned · stop", { exact: true })).toBeVisible();
  await expect(page.getByText("exact review · token vault · chat RPC", { exact: true })).toBeVisible();
  const runtimes = page.locator("#runtimes");
  await expect(runtimes.getByRole("heading", { name: "BrowserPod executes. Clawsembly decides." })).toBeVisible();
  await expect(runtimes.getByText("BrowserPod 2.x", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("SDK artifact ✓", { exact: true })).toBeVisible();
  await expect(runtimes.getByText(/report bytes, npm identity, and browser origin/)).toBeVisible();
  await expect(runtimes.getByText(/rechecks exact pairing access/)).toBeVisible();
  await expect(runtimes.getByText(/byte-reproducible SDK tarball/)).toBeVisible();
  await expect(runtimes.getByText(/isolated ESM and TypeScript consumers/)).toBeVisible();
  await expect(runtimes.getByText(/encrypts issued device tokens/)).toBeVisible();
  await expect(runtimes.getByText(/bounded chat\/history\/abort RPC/)).toBeVisible();
  await expect(runtimes.getByText(/Real provider evidence is unrun/)).toBeVisible();
  await expect(runtimes.getByText(/hard dispose remains unavailable/)).toBeVisible();
  await expect(runtimes.getByText("container2wasm", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("Archived ↗", { exact: true })).toBeVisible();
  await expect(runtimes.getByText(/316\.7 MB/)).toBeVisible();
  await expect(runtimes.getByText("WebContainer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("none in app bundle", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(runtimes.getByRole("link", { name: "Run evidence capture ↗" })).toHaveAttribute(
    "href",
    "https://github.com/haya-inc/clawsembly/issues/6"
  );
  await expect(page.getByRole("link", { name: "Inspect SDK launch ↗" })).toHaveAttribute(
    "href",
    "https://haya-inc.github.io/clawsembly/sdk-host/"
  );
  await expect(page.getByRole("link", { name: "Download SDK alpha ↓" })).toHaveAttribute(
    "href",
    `./downloads/haya-inc-clawsembly-${sdkVersion}.tgz`
  );
  const registryLink = page.locator("[data-sdk-registry]");
  const distributionStatus = page.locator("[data-sdk-distribution-status]");
  if (npmPublication.status === "published") {
    await expect(registryLink).toHaveText("Install alpha from npm ↗");
    await expect(registryLink).toHaveAttribute(
      "href",
      `https://www.npmjs.com/package/@haya-inc/clawsembly/v/${sdkVersion}`
    );
    await expect(distributionStatus).toContainText(`npm install @haya-inc/clawsembly@${sdkVersion}`);
  } else {
    await expect(registryLink).toHaveText("npm bootstrap pending · manifest ↗");
    await expect(registryLink).toHaveAttribute("href", "./downloads/sdk-release.json");
    await expect(distributionStatus).toContainText("verified GitHub and Pages tarballs are available now");
  }
  await expect(page.getByRole("link", { name: "Release notes ↗" })).toHaveAttribute(
    "href",
    `https://github.com/haya-inc/clawsembly/releases/tag/v${sdkVersion}`
  );
  await expect(page.getByRole("link", { name: "Join the discussion ↗" })).toHaveAttribute(
    "href",
    "https://github.com/haya-inc/clawsembly/discussions/17"
  );
  await expect(page.getByRole("link", { name: "Show your integration ↗" })).toHaveAttribute(
    "href",
    "https://github.com/haya-inc/clawsembly/discussions/18"
  );
  const preview = index.releases.find((release) => release.channel === "preview");
  const dependencyDelta = preview?.deltaFromStable.directDependencyCount ?? 0;
  const expectedDelta = dependencyDelta === 0 ? "±0 deps" : `${dependencyDelta > 0 ? "+" : "−"}${Math.abs(dependencyDelta)} deps`;
  const previewRow = history.locator(".release-row").filter({ hasText: preview?.version ?? "preview" });
  await expect(previewRow.getByText(expectedDelta, { exact: true })).toBeVisible();
  const dependencyDiff = page.locator("[data-release-diff]");
  await expect(dependencyDiff).toBeVisible();
  const changes = preview?.dependencyChangesFromStable;
  expect(preview?.dependencyRiskFromStable.length).toBe(
    (changes?.added.length ?? 0) + (changes?.changed.length ?? 0)
  );
  expect(preview?.dependencyRiskFromStable.every((risk) => !risk.scan.truncated)).toBe(true);
  await expect(dependencyDiff.getByText(
    `${changes?.added.length ?? 0} added · ${changes?.changed.length ?? 0} changed · ${changes?.removed.length ?? 0} removed · ${preview?.dependencyRiskFromStable.length ?? 0} classified`,
    { exact: true }
  )).toBeVisible();
  await dependencyDiff.locator("summary").click();
  const firstAdded = changes?.added[0];
  if (firstAdded) {
    await expect(dependencyDiff.getByText(firstAdded.name, { exact: true })).toBeVisible();
    await expect(dependencyDiff.getByText(firstAdded.spec, { exact: true })).toBeVisible();
    const firstRisk = preview?.dependencyRiskFromStable.find((risk) => risk.name === firstAdded.name);
    const riskRow = dependencyDiff.locator("li").filter({ hasText: firstAdded.name });
    await expect(riskRow.locator(".release-diff-signals")).toHaveText(
      firstRisk?.signals.browserCapabilities.join(" · ") || "no package-level capability signal"
    );
  }
  const gatewayDiff = page.locator("[data-gateway-diff]");
  const contract = preview?.gatewayContractFromStable;
  await expect(gatewayDiff).toBeVisible();
  await expect(gatewayDiff.getByText(
    `${contract?.classification} · +${contract?.coreMethods.added.length} methods · +${contract?.schemaExports.added.length} schemas · protocol ${contract?.protocol.release.current}`,
    { exact: true }
  )).toBeVisible();
  await gatewayDiff.locator("summary").click();
  await expect(gatewayDiff.getByText(
    `${contract?.distribution.legacyPluginDeclarationCount.stable} → ${contract?.distribution.legacyPluginDeclarationCount.release}`,
    { exact: true }
  )).toBeVisible();
  const firstMethod = contract?.coreMethods.added[0];
  if (firstMethod) await expect(gatewayDiff.getByText(firstMethod, { exact: true })).toBeVisible();
  const promotionPolicy = page.locator("[data-promotion-policy]");
  await expect(promotionPolicy).toBeVisible();
  await expect(promotionPolicy.locator("[data-promotion-decision]")).toHaveText(policy.decision);
  await expect(promotionPolicy.locator("[data-promotion-version]")).toHaveText(policy.candidate.version);
  await expect(promotionPolicy).toHaveAttribute("href", "/data/promotion-policy.json");
  if (policy.candidate.reasons.includes("gateway-contract-breaking")) {
    await expect(promotionPolicy).toContainText("Gateway contract breaking");
  }
  expect(consoleErrors).toEqual([]);
});

test("release ledger remains readable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#releases");
  const section = page.locator("#releases");
  await expect(section.getByRole("heading", { name: "Stable, rollback, preview." })).toBeVisible();
  await expect(section.locator(".release-row")).toHaveCount(3);
  const bounds = await section.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const gatewayDiff = section.locator("[data-gateway-diff]");
  await gatewayDiff.locator("summary").click();
  const gatewayBounds = await gatewayDiff.boundingBox();
  expect(gatewayBounds).not.toBeNull();
  expect(gatewayBounds!.x).toBeGreaterThanOrEqual(0);
  expect(gatewayBounds!.x + gatewayBounds!.width).toBeLessThanOrEqual(390);
  await expect(gatewayDiff.locator(".gateway-diff-group")).toHaveCount(4);
  const policyBounds = await section.locator("[data-promotion-policy]").boundingBox();
  expect(policyBounds).not.toBeNull();
  expect(policyBounds!.x).toBeGreaterThanOrEqual(0);
  expect(policyBounds!.x + policyBounds!.width).toBeLessThanOrEqual(390);
  const brokerBounds = await page.locator("#broker").boundingBox();
  expect(brokerBounds).not.toBeNull();
  expect(brokerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(brokerBounds!.x + brokerBounds!.width).toBeLessThanOrEqual(390);
});
