import { expect, test } from "@playwright/test";

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
    }>;
  };
  expect(index.releases.map((release) => release.channel)).toEqual(["stable", "previous", "preview"]);
  expect(new Set(Object.values(index.channels)).size).toBe(3);

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
  await expect(page.getByText("challenge · chat RPC · reconnect", { exact: true })).toBeVisible();
  const runtimes = page.locator("#runtimes");
  await expect(runtimes.getByRole("heading", { name: "BrowserPod executes. Clawsembly decides." })).toBeVisible();
  await expect(runtimes.getByText("BrowserPod 2.x", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("Chat contract ✓", { exact: true })).toBeVisible();
  await expect(runtimes.getByText(/npm identity and browser origin/)).toBeVisible();
  await expect(runtimes.getByText(/signs protocol 4/)).toBeVisible();
  await expect(runtimes.getByText(/bounded chat\/history\/abort RPC/)).toBeVisible();
  await expect(runtimes.getByText(/digest-pinned Node client carries broker calls/)).toBeVisible();
  await expect(runtimes.getByText(/Real provider evidence is unrun/)).toBeVisible();
  await expect(runtimes.getByText(/hard dispose remains unavailable/)).toBeVisible();
  await expect(runtimes.getByText("container2wasm", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("Archived ↗", { exact: true })).toBeVisible();
  await expect(runtimes.getByText(/316\.7 MB/)).toBeVisible();
  await expect(runtimes.getByText("WebContainer", { exact: true })).toHaveCount(0);
  await expect(page.getByText("none in app bundle", { exact: true })).toBeVisible();
  await expect(runtimes.getByText("Rejected", { exact: true })).toBeVisible();
  const preview = index.releases.find((release) => release.channel === "preview");
  const dependencyDelta = preview?.deltaFromStable.directDependencyCount ?? 0;
  const expectedDelta = dependencyDelta === 0 ? "±0 deps" : `${dependencyDelta > 0 ? "+" : "−"}${Math.abs(dependencyDelta)} deps`;
  const previewRow = history.locator(".release-row").filter({ hasText: preview?.version ?? "preview" });
  await expect(previewRow.getByText(expectedDelta, { exact: true })).toBeVisible();
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
  const brokerBounds = await page.locator("#broker").boundingBox();
  expect(brokerBounds).not.toBeNull();
  expect(brokerBounds!.x).toBeGreaterThanOrEqual(0);
  expect(brokerBounds!.x + brokerBounds!.width).toBeLessThanOrEqual(390);
});
