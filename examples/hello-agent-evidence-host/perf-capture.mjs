#!/usr/bin/env node
// Owner-authorized performance-baseline capture for the hello-agent
// reference chain (issue #8). Every listed boot is a REAL metered BrowserPod
// boot; the plan and its total cost are printed before the first spend.
//
//   node perf-capture.mjs [--samples N] [--paths cold,warm,persistentReuse] [--out DIR]
//
// Pass placement:
//   cold            fresh browser context (empty caches), fresh workspace
//   warm            reused context after a reload (caches hot), fresh workspace
//   persistentReuse reused context, SAME workspace as a seed boot, so the
//                   provider's persistent filesystem is being re-opened
//                   (one extra seed boot is spent to create that workspace)
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { resolve } from "node:path";
import { createServer } from "vite";
import {
  HELLO_AGENT_ARTIFACT
} from "../../packages/hello-agent-binding/hello-agent-artifact.generated.mjs";
import {
  HELLO_AGENT_PERF_PASS_KINDS,
  assertHelloAgentPerfBaseline,
  helloAgentPerfRecord,
  summarizeHelloAgentPerfSamples
} from "../../packages/hello-agent-binding/hello-agent-perf.mjs";

const root = resolve(import.meta.dirname, "../..");
const apiKey = process.env.BROWSERPOD_API_KEY;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseArguments(argv) {
  const options = { samples: 1, paths: [...HELLO_AGENT_PERF_PASS_KINDS], out: "test-results/hello-agent-perf" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--samples") {
      options.samples = Number.parseInt(value ?? "", 10);
      index += 1;
    } else if (flag === "--paths") {
      options.paths = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
      index += 1;
    } else if (flag === "--out") {
      if (typeof value !== "string" || !value) throw fail("invalid_arguments", "--out needs a directory.");
      options.out = value;
      index += 1;
    } else {
      throw fail("invalid_arguments", `Unknown perf-capture argument: ${flag}`);
    }
  }
  if (!Number.isSafeInteger(options.samples) || options.samples < 1 || options.samples > 10) {
    throw fail("invalid_arguments", "--samples must be an integer between 1 and 10.");
  }
  const known = new Set(HELLO_AGENT_PERF_PASS_KINDS);
  if (options.paths.length < 1 || options.paths.some((path) => !known.has(path))) {
    throw fail("invalid_arguments", `--paths accepts a comma list of: ${[...known].join(", ")}`);
  }
  return options;
}

const options = parseArguments(process.argv.slice(2));
const outputDirectory = resolve(root, options.out);
const statusPath = resolve(outputDirectory, "perf-status.json");
await mkdir(outputDirectory, { recursive: true });

const artifact = {
  package: HELLO_AGENT_ARTIFACT.name,
  version: HELLO_AGENT_ARTIFACT.version,
  integrity: HELLO_AGENT_ARTIFACT.integrity
};
const baselinePath = resolve(outputDirectory, `hello-agent-perf-${artifact.version}.json`);
const recordPath = resolve(outputDirectory, `hello-agent-perf-${artifact.version}.record.json`);

const plannedBoots = options.paths.reduce(
  (total, path) => total + options.samples + (path === "persistentReuse" ? 1 : 0),
  0
);
process.stdout.write(
  `Perf plan: ${options.paths.join(", ")} × ${options.samples} sample(s) = ${plannedBoots} metered BrowserPod boot(s) (persistentReuse includes one seed boot).\n`
);

let server;
let browser;
let pageUrl;
let stage = "initialize";
const collected = { cold: [], warm: [], persistentReuse: [] };
let bootsSpent = 0;
let target = null;

async function runPass(page, passKind, workspaceId) {
  await page.goto(pageUrl, { waitUntil: "load" });
  await page.waitForFunction(
    () => typeof globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_PERF_PASS__ === "function",
    undefined,
    { timeout: 60_000 }
  );
  bootsSpent += 1;
  const result = await page.evaluate(async ({ credential, kind, workspace }) => {
    const run = globalThis.__RUN_CLAWSEMBLY_HELLO_AGENT_PERF_PASS__({
      apiKey: credential,
      passKind: kind,
      workspaceId: workspace
    });
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("hello-agent perf pass timed out.")), 10 * 60 * 1_000);
    });
    return Promise.race([run, timeout]);
  }, { credential: apiKey, kind: passKind, workspace: workspaceId });
  if (target === null) {
    target = { runtimeVersion: result.runtimeVersion, browser: result.browser };
  } else if (target.runtimeVersion !== result.runtimeVersion || target.browser !== result.browser) {
    throw fail("target_drift", "The provider or browser changed between perf passes.");
  }
  return result.sample;
}

try {
  if (typeof apiKey !== "string" || !apiKey) {
    throw fail("missing_api_key", "BROWSERPOD_API_KEY is required for an owner-authorized perf capture.");
  }
  if (apiKey.length > 4_096) {
    throw fail("api_key_too_long", "BROWSERPOD_API_KEY exceeds the expected credential length.");
  }
  stage = "host-server-start";
  server = await createServer({
    configFile: resolve(import.meta.dirname, "vite.config.mjs"),
    logLevel: "silent"
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw fail("host_address_unavailable", "Perf host address is unavailable.");
  pageUrl = `http://127.0.0.1:${address.port}/perf.html`;
  stage = "browser-launch";
  browser = await chromium.launch({ headless: true });

  const runStamp = Date.now().toString(36);
  if (options.paths.includes("cold")) {
    stage = "pass-cold";
    for (let index = 1; index <= options.samples; index += 1) {
      // A fresh context starts with empty HTTP and compilation caches, so
      // every cold sample pays first-visit delivery cost.
      const context = await browser.newContext();
      const page = await context.newPage();
      collected.cold.push(await runPass(page, "cold", `perf-${runStamp}-cold-${index}`));
      await context.close();
      process.stdout.write(`cold sample ${index}/${options.samples} measured.\n`);
    }
  }

  const needsSharedContext = options.paths.includes("warm") || options.paths.includes("persistentReuse");
  if (needsSharedContext) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // First visit warms the context's caches; warm and persistent samples
    // then reload within the same context.
    if (options.paths.includes("warm")) {
      stage = "pass-warm";
      for (let index = 1; index <= options.samples; index += 1) {
        collected.warm.push(await runPass(page, "warm", `perf-${runStamp}-warm-${index}`));
        process.stdout.write(`warm sample ${index}/${options.samples} measured.\n`);
      }
    }
    if (options.paths.includes("persistentReuse")) {
      stage = "pass-persistent-seed";
      const workspaceId = `perf-${runStamp}-persist`;
      // The seed boot creates the persistent workspace; it is intentionally
      // not a persistentReuse sample because nothing is being reused yet.
      await runPass(page, "warm", workspaceId);
      process.stdout.write("persistentReuse seed boot completed.\n");
      stage = "pass-persistent";
      for (let index = 1; index <= options.samples; index += 1) {
        collected.persistentReuse.push(await runPass(page, "persistentReuse", workspaceId));
        process.stdout.write(`persistentReuse sample ${index}/${options.samples} measured.\n`);
      }
    }
    await context.close();
  }

  stage = "summarize";
  const passes = {};
  for (const passKind of options.paths) {
    passes[passKind] = summarizeHelloAgentPerfSamples(passKind, collected[passKind]);
  }
  const baseline = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    target: {
      runtime: "browserpod",
      browserLocal: true,
      runtimeVersion: target.runtimeVersion,
      browser: target.browser,
      os: `${process.platform} ${release()}`
    },
    artifact,
    scope: {
      chain: "hello-agent-reference-binding",
      upstreamApplicability: "none"
    },
    passes
  };
  assertHelloAgentPerfBaseline(baseline);
  const record = await helloAgentPerfRecord(baseline);

  stage = "persist";
  await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: baseline.capturedAt,
    result: "pass",
    artifact,
    bootsSpent,
    sampleCounts: Object.fromEntries(
      Object.entries(passes).map(([key, summary]) => [key, summary.sampleCount])
    )
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(
    `Captured a validated hello-agent perf baseline (${bootsSpent} metered boot(s) spent).\n`
  );
} catch (error) {
  const directCode = typeof error?.code === "string" && /^[a-z0-9_-]{1,64}$/u.test(error.code)
    ? error.code
    : null;
  await writeFile(statusPath, `${JSON.stringify({
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    result: "fail",
    artifact,
    errorCode: directCode ?? "perf_capture_failed",
    failedStage: stage,
    bootsSpent,
    collectedCounts: Object.fromEntries(
      Object.entries(collected).map(([key, samples]) => [key, samples.length])
    )
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  throw new Error("hello-agent perf capture failed; inspect the payload-free status artifact.");
} finally {
  await browser?.close();
  await server?.close();
}
