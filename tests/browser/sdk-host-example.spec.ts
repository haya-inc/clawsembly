import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const testPort = Number(process.env.CLAWSEMBLY_TEST_PORT ?? "5173");
const sdkHostURL = `http://127.0.0.1:${testPort + 1}`;
const reportURL = "https://haya-inc.github.io/clawsembly/data/compatibility.json";
const reportSource = readFileSync(resolve("apps/web/public/data/compatibility.json"), "utf8");
const report = JSON.parse(reportSource) as {
  artifact: { version: string; integrity: string };
};

test("packed SDK host renders the current fail-closed launch decision", async ({ page }) => {
  const prohibitedRequests: string[] = [];
  const consoleErrors: string[] = [];
  let reportRequests = 0;
  page.on("request", (request) => {
    if (/browserpod\.io|api\.openai\.com/u.test(request.url())) prohibitedRequests.push(request.url());
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.route(reportURL, async (route) => {
    reportRequests += 1;
    await route.fulfill({
      body: reportSource,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  });

  await page.goto(sdkHostURL);
  await expect(page.getByRole("heading", { name: "Provider boot blocked" })).toBeVisible();
  await expect(page.locator("[data-decision-state]")).toHaveText("blocked");
  await expect(page.locator("[data-version]")).toHaveText(report.artifact.version);
  await expect(page.locator("[data-integrity]")).toHaveText(report.artifact.integrity);
  await expect(page.locator("[data-runtime]")).toHaveText("browserpod@2.12.1");
  await expect(page.locator("[data-report-status]")).toHaveText("probing");
  await expect(page.locator("[data-report-digest]")).toHaveText("ddc8bb3db11c62d1ee7ee0dc6f704182dcda37a7d054f8586edf02374d95c4b3");
  await expect(page.locator("[data-blockers] li")).toHaveText("report status is probing, not supported");
  await expect(page.locator("[data-provider-state]")).toHaveText("Not attempted");
  await expect(page.getByText("No API key field exists here.")).toBeVisible();
  expect(reportRequests).toBe(1);

  await page.getByRole("button", { name: "Recheck evidence" }).click();
  await expect.poll(() => reportRequests).toBe(2);
  await expect(page.locator("[data-decision-state]")).toHaveText("blocked");
  expect(prohibitedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("SDK host stays blocked when evidence is unavailable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(reportURL, (route) => route.abort("failed"));
  await page.goto(sdkHostURL);

  await expect(page.getByRole("heading", { name: "Report unavailable" })).toBeVisible();
  await expect(page.locator("[data-decision-state]")).toHaveText("error");
  await expect(page.locator("[data-provider-state]")).toHaveText("Not attempted");
  await expect(page.locator("[data-blockers] li")).toHaveText("A current, valid compatibility report is required.");
  const bounds = await page.locator("main").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

test("SDK host rejects a hand-edited supported claim before provider boot", async ({ page }) => {
  const prohibitedRequests: string[] = [];
  page.on("request", (request) => {
    if (/browserpod\.io|api\.openai\.com/u.test(request.url())) prohibitedRequests.push(request.url());
  });
  const tampered = reportSource.replace('"status": "probing"', '"status": "supported"');
  await page.route(reportURL, (route) => route.fulfill({
    body: tampered,
    contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*" }
  }));
  await page.goto(sdkHostURL);

  await expect(page.getByRole("heading", { name: "Report unavailable" })).toBeVisible();
  await expect(page.locator("[data-provider-state]")).toHaveText("Not attempted");
  expect(prohibitedRequests).toEqual([]);
});
