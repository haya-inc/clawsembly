// clawsembly-hello-agent: the guest side of the hello-agent reference
// binding. It serves exactly one protocol method (hello.say) over a bounded
// file mailbox and exists only to prove the Clawsembly embedding boundary is
// upstream-portable. It is not a real agent.
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";

const PROTOCOL = "clawsembly-hello/1";
const READY_LINE = "[hello-agent] ready";
const REQUEST_FILE_PATTERN = /^request-([A-Za-z0-9_-]{1,64})\.json$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_REQUEST_BYTES = 4_096;
const POLL_INTERVAL_MS = 50;

const sessionRoot = process.argv[2];
if (typeof sessionRoot !== "string" || !sessionRoot.startsWith("/") || sessionRoot.includes("\0")) {
  console.error("[hello-agent] error invalid_session_root");
  process.exit(1);
}
const requestsRoot = `${sessionRoot}/requests`;
const responsesRoot = `${sessionRoot}/responses`;
const sessionToken = globalThis.crypto.randomUUID();

async function writeAtomically(path, value) {
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(`${path}.tmp`, text, "utf8");
  await rename(`${path}.tmp`, path);
}

function printableName(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 64
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function answer(request) {
  if (!exactKeys(request, ["schemaVersion", "id", "method", "sessionToken", "params"])
    || request.schemaVersion !== 1 || request.method !== "hello.say"
    || request.sessionToken !== sessionToken
    || !exactKeys(request.params, ["name"]) || !printableName(request.params.name)) {
    // Generic rejection: no request material is echoed back.
    return { ok: false, error: { code: "invalid_request" } };
  }
  return { ok: true, result: { greeting: `Hello, ${request.params.name}!` } };
}

const answered = new Set();

async function serveOnce() {
  const entries = await readdir(requestsRoot);
  for (const entry of entries.slice(0, 64)) {
    const match = REQUEST_FILE_PATTERN.exec(entry);
    if (!match || answered.has(match[1])) continue;
    const id = match[1];
    const requestPath = `${requestsRoot}/${entry}`;
    const info = await stat(requestPath);
    if (info.size > MAX_REQUEST_BYTES) {
      answered.add(id);
      await writeAtomically(`${responsesRoot}/response-${id}.json`, {
        schemaVersion: 1,
        id,
        ok: false,
        error: { code: "invalid_request" }
      });
      continue;
    }
    let request;
    try { request = JSON.parse(await readFile(requestPath, "utf8")); }
    catch { continue; /* The request file may still be in flight. */ }
    answered.add(id);
    const outcome = answer(request);
    await writeAtomically(`${responsesRoot}/response-${id}.json`, {
      schemaVersion: 1,
      id,
      ...outcome
    });
  }
}

await mkdir(requestsRoot, { recursive: true });
await mkdir(responsesRoot, { recursive: true });
await writeAtomically(`${sessionRoot}/ready.json`, {
  schemaVersion: 1,
  protocol: PROTOCOL,
  sessionToken,
  startedAt: new Date().toISOString()
});
console.log(READY_LINE);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => process.exit(0));
}
setInterval(() => {
  serveOnce().catch(() => { /* The next poll retries; requests are idempotent. */ });
}, POLL_INTERVAL_MS);
