#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_MAX_REPORT_AGE_MS,
  DEFAULT_REPORT_URL,
  renderSdkHostReportPin
} from "../packages/compatibility/src/sdk-host-report-pin.mjs";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const reportPath = resolve(valueAfter("--report", "apps/web/public/data/compatibility.json"));
const outputPath = resolve(valueAfter("--output", "examples/sdk-host/src/report-pin.ts"));
const url = valueAfter("--url", DEFAULT_REPORT_URL);
const maxAgeMs = Number(valueAfter("--max-age-ms", String(DEFAULT_MAX_REPORT_AGE_MS)));
const checkOnly = args.includes("--check");

const reportSource = await readFile(reportPath, "utf8");
const generated = renderSdkHostReportPin(reportSource, { url, maxAgeMs });
if (checkOnly) {
  let current;
  try { current = await readFile(outputPath, "utf8"); }
  catch { current = undefined; }
  if (current !== generated) {
    throw new Error(`SDK host report pin is stale; run node scripts/generate-sdk-host-report-pin.mjs`);
  }
  process.stdout.write("SDK host report pin is current.\n");
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, generated);
  process.stdout.write(`Wrote ${outputPath}\n`);
}
