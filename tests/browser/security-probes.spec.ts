import { expect, test } from "@playwright/test";

// Exercises the browser-host security core (credential vault, provider broker
// policy, device identity) through the page's own self-probes. Unlike
// runtime-probe.spec.ts this suite boots no WebContainer and never contacts a
// model provider. The page may still load its CSP-approved static font assets.
test("browser host security probes pass without WebContainer or provider traffic", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  const approvedStaticHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
  const unexpectedExternalRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1"
      && url.hostname !== "localhost"
      && !approvedStaticHosts.has(url.hostname)) {
      unexpectedExternalRequests.push(request.url());
    }
  });

  await page.goto("/");

  const vaultHealth = page.locator("[data-vault-health]");
  await expect(vaultHealth).toHaveText("VAULT + CAPABILITY BROKER / PASS");
  await expect(vaultHealth).toHaveAttribute("data-state", "pass");

  const deviceHealth = page.locator("[data-device-health]");
  await expect(deviceHealth).toHaveAttribute("data-state", "pass");
  await expect(page.locator("[data-device-id]")).toContainText("…");

  expect(consoleErrors).toEqual([]);
  expect(unexpectedExternalRequests).toEqual([]);
});

test("credential vault stores and removes a secret without exposing it", async ({ page }) => {
  const probeSecret = "sk-clawsembly-security-spec-000000000000";
  await page.goto("/");
  await expect(page.locator("[data-vault-health]")).toHaveAttribute("data-state", "pass");

  await page.locator("[data-credential-input]").fill(probeSecret);
  await page.locator("[data-save-credential]").click();
  await expect(page.locator("[data-vault-status]")).toContainText("Encrypted and stored");
  await expect(page.locator("[data-vault-status]")).toContainText("OpenAI credential stored");
  await expect(page.locator("[data-credential-input]")).toHaveValue("");
  expect(await page.content()).not.toContain(probeSecret);

  await page.reload();
  await expect(page.locator("[data-vault-status]")).toContainText("OpenAI credential stored");
  expect(await page.content()).not.toContain(probeSecret);

  await page.locator("[data-clear-credential]").click();
  await expect(page.locator("[data-vault-status]")).toContainText("no OpenAI credential stored");
});
