import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test("pinned OpenClaw completes the browser session lifecycle", async ({ page, request }, testInfo) => {
  const liveProviderRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url() === "https://api.openai.com/v1/responses") liveProviderRequests.push(request.url());
  });
  const reportResponse = await request.get("/data/compatibility.json");
  expect(reportResponse.ok()).toBe(true);
  const report = await reportResponse.json() as { artifact: { version: string } };
  await page.goto("/#compatibility");
  await expect(page.locator("html")).toHaveAttribute("data-openclaw-version", report.artifact.version);

  const vaultStatus = page.locator("[data-vault-status]");
  await expect(vaultStatus).toContainText("Vault verified");
  await expect(page.locator("[data-vault-health]")).toHaveText("VAULT + BROKER / PASS");
  await expect(page.locator("[data-device-health]")).toHaveText("SIGNATURE / PASS");
  const deviceId = await page.locator("[data-device-id]").getAttribute("title");
  expect(deviceId).toMatch(/^[a-f0-9]{64}$/);
  const testCredential = "sk-clawsembly-browser-test-secret";
  await page.getByLabel("OpenAI API key").fill(testCredential);
  await page.getByRole("button", { name: "Save encrypted" }).click();
  await expect(vaultStatus).toContainText("OpenAI credential stored");
  await expect(page.getByLabel("OpenAI API key")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(testCredential);

  await page.reload();
  await expect(vaultStatus).toContainText("OpenAI credential stored");
  await expect(page.locator("[data-device-id]")).toHaveAttribute("title", deviceId ?? "");
  const liveRun = page.getByRole("button", { name: "Run protected live test" });
  const liveConsent = page.getByLabel("I understand this makes one billable OpenAI API request.", { exact: true });
  await expect(liveRun).toBeDisabled();
  await expect(page.locator("[data-live-cost]")).toContainText("≤ $0.001 upper bound");
  await liveConsent.check();
  await expect(liveRun).toBeEnabled();
  await expect(page.locator("[data-live-output]")).toBeHidden();
  await liveConsent.uncheck();
  await expect(liveRun).toBeDisabled();
  await page.getByRole("button", { name: "Clear credential" }).click();
  await expect(vaultStatus).toContainText("no OpenAI credential stored");
  await expect(page.locator("[data-live-status]")).toContainText("save an OpenAI credential first");
  await page.getByLabel("Requests", { exact: true }).fill("5");
  await page.getByLabel("Input chars", { exact: true }).fill("120000");
  await page.getByLabel("Output chars", { exact: true }).fill("90000");

  await page.getByRole("button", { name: "Run environment probe" }).click();
  const install = page.getByRole("button", { name: "Install pinned OpenClaw" });
  await expect(install).toBeEnabled({ timeout: 30_000 });
  await install.click();
  await expect(page.getByRole("button", { name: "Install probe passed" })).toBeVisible({ timeout: 150_000 });

  const runtime = page.getByRole("button", { name: "Run lifecycle probe" });
  await expect(runtime).toBeEnabled();
  await runtime.click();
  await expect(page.getByRole("button", { name: "Runtime + recovery passed" })).toBeVisible({ timeout: 150_000 });

  const output = page.locator("[data-install-output]");
  await expect(output).toContainText('[readyz] {"status":200');
  await expect(output).toContainText("[gateway-ready] protocol services available");
  await expect(output).toContainText('[device-handshake] {"deviceId":"');
  await expect(output).toContainText('"signatureVersion":"v3","privateKeyInWebContainer":false,"result":"pass"');
  await expect(output).toContainText('[device-pairing] {"deviceId":"');
  await expect(output).toContainText('"deviceTokenIssued":true,"deviceTokenEncryptedAtRest":true,"deviceTokenReconnect":true,"tokenPlaintextLogged":false,"result":"pass"');
  await expect(output).not.toContainText("[device-token-challenge]");
  await expect(page.locator("[data-device-health]")).toHaveText("SIGNATURE + TOKEN / PASS");
  await expect(output).toContainText('[host-broker-ready] {"port":19003');
  await expect(output).toContainText('[host-broker-request] {"modelAlias":"broker-v1","hostModel":"gpt-5.6-luna"');
  await expect(output).toContainText('[host-broker-turn] {"openclawAgent":"broker"');
  await expect(output).toContainText('"store":false,"streaming":true,"typedDeltas":true,"toolRoundTrip":true,"responsesFunctionResultInput":true');
  await expect(output).toContainText('"budget":{"maxRequests":5,"maxInputChars":120000,"maxOutputChars":90000,"requestsUsed":3');
  await expect(output).toContainText('"cancellationPropagated":true,"credentialInWebContainer":false');
  await expect(output).toContainText('"credentialPlaintextLogged":false,"responseReachedOpenClaw":true,"result":"pass"');
  await expect(output).toContainText("[host-broker-cancel] provider AbortSignal triggered");
  await expect(output).not.toContainText("sk-clawsembly-host-broker-");
  expect(liveProviderRequests).toEqual([]);
  await expect(output).toContainText('"event":"hello","instance":"initial","protocol":4');
  await expect(output).toContainText('"toolCount":1,"toolNames":["agents_list"]');
  await expect(output).toContainText('"hasToolResult":true');
  await expect(output).toContainText('"event":"history","phase":"reconnected"');
  await expect(output).toContainText('"state":"aborted","runId":"clawsembly-cancel-turn-');
  await expect(output).toContainText('"event":"lifecycle","history":true,"reconnect":true,"cancellation":true,"toolRoundTrip":true');
  await expect(output).toContainText('[opfs-recovery] {"snapshotBytes":');
  await expect(output).toContainText('"backupVersion":1,"integrity":"sha256"');
  await expect(output).toContainText('"checksumMismatchRejected":true,"unknownVersionRejected":true');
  await expect(output).toContainText('"runtimeRestart":true,"result":"pass"');
  await expect(output).toContainText('[runtime-performance] {"coldRootInstallMs":');
  const runtimePerformanceLine = (await output.textContent() ?? "")
    .split("\n")
    .find((line) => line.startsWith("[runtime-performance] "));
  expect(runtimePerformanceLine).toBeTruthy();
  const runtimePerformance = JSON.parse(runtimePerformanceLine!.slice("[runtime-performance] ".length)) as {
    coldRootInstallMs: number;
    nestedRepairMs: number;
    coldTotalMs: number;
    warmInstallMs: number;
    nodeModules: { bytes: number; files: number };
    npmCache: { bytes: number; files: number };
    gatewayPortReadyMs: number;
    gatewayProtocolReadyMs: number;
    result: string;
  };
  expect(runtimePerformance.coldRootInstallMs).toBeGreaterThan(0);
  expect(runtimePerformance.nestedRepairMs).toBeGreaterThan(0);
  expect(runtimePerformance.coldTotalMs).toBeGreaterThanOrEqual(runtimePerformance.coldRootInstallMs + runtimePerformance.nestedRepairMs);
  expect(runtimePerformance.warmInstallMs).toBeLessThan(runtimePerformance.coldTotalMs);
  expect(runtimePerformance.nodeModules.bytes).toBeGreaterThan(80_000_000);
  expect(runtimePerformance.nodeModules.files).toBeGreaterThan(1_000);
  expect(runtimePerformance.npmCache.bytes).toBeGreaterThan(1_000_000);
  expect(runtimePerformance.gatewayPortReadyMs).toBeGreaterThan(0);
  expect(runtimePerformance.gatewayProtocolReadyMs).toBeGreaterThanOrEqual(runtimePerformance.gatewayPortReadyMs);
  expect(runtimePerformance.result).toBe("pass");
  console.log(`[runtime-performance-evidence] ${JSON.stringify(runtimePerformance)}`);
  const sanitizedRuntimeEvidence = (await output.textContent() ?? "")
    .split("\n")
    .filter((line) => line.startsWith("[readyz] ")
      || line.startsWith("[gateway-ready] ")
      || line.startsWith("[device-handshake] ")
      || line.startsWith("[device-pairing] ")
      || line.startsWith("[host-broker-turn] ")
      || line.startsWith("[opfs-recovery] ")
      || line.startsWith("[runtime-performance] "));
  const evidenceName = `openclaw-${report.artifact.version}-runtime-evidence.json`;
  const evidencePath = testInfo.outputPath(evidenceName);
  await writeFile(evidencePath, `${JSON.stringify({
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      openclaw: { version: report.artifact.version },
      liveProviderRequests: liveProviderRequests.length,
      records: sanitizedRuntimeEvidence
    }, null, 2)}\n`);
  await testInfo.attach(evidenceName, {
    path: evidencePath,
    contentType: "application/json"
  });
  await expect(page.getByRole("button", { name: "Export backup" })).toBeEnabled();
  await expect(page.locator("[data-storage-status]")).toContainText("Saved mock state");

  await page.reload();
  await expect(page.locator("[data-storage-status]")).toContainText("Saved mock state");
  await expect(page.locator("[data-device-health]")).toHaveText("SIGNATURE + TOKEN / PASS");
});
