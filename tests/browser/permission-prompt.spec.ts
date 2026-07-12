import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("permission prompt creates exact grants and exports payload-free audit", async ({ page }) => {
  const prohibitedRequests: string[] = [];
  page.on("request", (request) => {
    if (/api\.openai\.com|browserpod\.io/u.test(request.url())) prohibitedRequests.push(request.url());
  });
  await page.goto("/#broker");
  const prompt = page.locator("[data-permission-prompt]");
  await expect(prompt.locator(".permission-row")).toHaveCount(3);
  await expect(prompt.locator('.permission-row[data-permission-status="pending"]')).toHaveCount(3);

  const provider = prompt.locator('[data-permission-capability="provider.openai.responses"]');
  await provider.locator("[data-permission-duration]").selectOption(String(5 * 60_000));
  await provider.locator("[data-permission-max-calls]").fill("1");
  await provider.getByRole("button", { name: /Approve provider\.openai\.responses/u }).click();
  await expect(provider).toHaveAttribute("data-permission-status", "granted");
  await expect(provider.getByText("Granted", { exact: true })).toBeVisible();
  await expect(provider.getByText(/Expires/u)).toBeVisible();

  await provider.getByRole("button", { name: /Revoke provider\.openai\.responses/u }).click();
  await expect(provider).toHaveAttribute("data-permission-status", "revoked");

  const storage = prompt.locator('[data-permission-capability="storage.snapshot"]');
  await storage.getByRole("button", { name: /Deny storage\.snapshot/u }).click();
  await expect(storage).toHaveAttribute("data-permission-status", "denied");

  const downloadPromise = page.waitForEvent("download");
  await prompt.getByRole("button", { name: "Export audit JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^clawsembly-.*-capability-audit\.json$/u);
  const path = await download.path();
  expect(path).not.toBeNull();
  const source = await readFile(path!, "utf8");
  const audit = JSON.parse(source) as {
    subject: { runtime: string; sessionId: string };
    permissionAudit: { events: Array<{ action: string; capability: string }> };
    brokerAudit: { events: Array<{ action: string }> };
  };
  expect(audit.subject).toMatchObject({ runtime: "browserpod", sessionId: "public-permission-demo" });
  expect(audit.permissionAudit.events.map((event) => event.action)).toEqual(["approve", "revoke", "deny"]);
  expect(audit.permissionAudit.events[0]?.capability).toBe("provider.openai.responses");
  expect(audit.brokerAudit.events.map((event) => event.action)).toEqual(["grant", "revoke"]);
  expect(source).not.toContain("input");
  expect(source).not.toContain("payload");
  expect(source).not.toMatch(/sk-[A-Za-z0-9]/u);
  expect(prohibitedRequests).toEqual([]);
});

test("permission prompt remains operable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#broker");
  const prompt = page.locator("[data-permission-prompt]");
  await expect(prompt.locator(".permission-row")).toHaveCount(3);
  const bounds = await prompt.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const first = prompt.locator(".permission-row").first();
  await expect(first.locator("[data-permission-duration]")).toBeVisible();
  await expect(first.locator("[data-permission-max-calls]")).toBeVisible();
  await expect(first.locator("[data-permission-approve]")).toBeVisible();
  await expect(first.locator("[data-permission-deny]")).toBeVisible();
});
