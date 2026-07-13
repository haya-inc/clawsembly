// clawsembly-hello-agent: the guest side of the hello-agent reference
// binding. It serves a bounded file-mailbox protocol whose shape mirrors the
// OpenClaw embedding surface - one greeting method plus chat send, history,
// and abort - and it can do chat work only by delegating every completion to
// the embedder-controlled host boundary through the staged capability
// mailbox client. It exists to prove the Clawsembly embedding boundary is
// upstream-portable and externally extensible. It is not a real agent.
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL = "clawsembly-hello/2";
const READY_LINE = "[hello-agent] ready";
const REQUEST_FILE_PATTERN = /^request-([A-Za-z0-9_-]{1,64})\.json$/u;
const TARGET_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_REQUEST_BYTES = 4_096;
const POLL_INTERVAL_MS = 50;
const MAX_MESSAGE_CHARS = 1_024;
const MAX_REPLY_CHARS = 2_048;
const MAX_DELTA_CHARS = 512;
const HISTORY_KEPT_TURNS = 64;
const HISTORY_REPORTED_TURNS = 8;
const HISTORY_TEXT_CHARS = 96;
const CHAT_CAPABILITY = "chat.complete";
const CHAT_SCOPE = "provider:reference";
const CAPABILITY_TIMEOUT_MS = 30_000;

const sessionRoot = process.argv[2];
if (typeof sessionRoot !== "string" || !sessionRoot.startsWith("/") || sessionRoot.includes("\0")) {
  console.error("[hello-agent] error invalid_session_root");
  process.exit(1);
}
const requestsRoot = `${sessionRoot}/requests`;
const responsesRoot = `${sessionRoot}/responses`;
const eventsRoot = `${sessionRoot}/events`;
const sessionToken = globalThis.crypto.randomUUID();

// The host boundary supplies the digest-pinned capability mailbox client and
// its channel through the environment. Partial wiring is a boot failure, not
// a degraded mode; absent wiring leaves chat explicitly unavailable.
async function connectCapabilityTransport() {
  const root = process.env.CLAWSEMBLY_MAILBOX_ROOT;
  const channelId = process.env.CLAWSEMBLY_MAILBOX_CHANNEL;
  const clientPath = process.env.CLAWSEMBLY_MAILBOX_CLIENT;
  const provided = [root, channelId, clientPath]
    .filter((value) => typeof value === "string" && value.length > 0);
  if (provided.length === 0) return null;
  if (provided.length !== 3) throw new Error("capability transport wiring is incomplete");
  const module = await import(pathToFileURL(resolve(clientPath)).href);
  const client = new module.FilesystemCapabilityMailboxClient({ root, channelId });
  await client.connect();
  return client;
}

let capabilityTransport = null;
try {
  capabilityTransport = await connectCapabilityTransport();
} catch {
  console.error("[hello-agent] error capability_transport_failed");
  process.exit(1);
}

async function writeAtomically(path, value) {
  const text = `${JSON.stringify(value)}\n`;
  await writeFile(`${path}.tmp`, text, "utf8");
  await rename(`${path}.tmp`, path);
}

function printableText(value, maxChars) {
  return typeof value === "string" && value.length >= 1 && value.length <= maxChars
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function truncateForHistory(value) {
  if (typeof value !== "string") return null;
  return value.length > HISTORY_TEXT_CHARS ? value.slice(0, HISTORY_TEXT_CHARS) : value;
}

const answered = new Set();
const history = [];
let inflightTurn = null;

async function runChatTurn(id, message) {
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  inflightTurn = { id, controller };
  const turnEventsRoot = `${eventsRoot}/${id}`;
  let sequence = 0;
  const emit = async (event) => {
    sequence += 1;
    await writeAtomically(
      `${turnEventsRoot}/event-${String(sequence).padStart(8, "0")}.json`,
      { schemaVersion: 1, id, sequence, ...event }
    );
  };

  let reply = null;
  let reason = "completed";
  let errorCode = null;
  try {
    await mkdir(turnEventsRoot, { recursive: true });
    const result = await capabilityTransport.request({
      id: `chat-${id}`,
      capability: CHAT_CAPABILITY,
      scope: CHAT_SCOPE,
      input: { message }
    }, { signal: controller.signal, timeoutMs: CAPABILITY_TIMEOUT_MS });
    if (!result || typeof result !== "object" || Array.isArray(result)
      || !printableText(result.reply, MAX_REPLY_CHARS)) {
      reason = "failed";
      errorCode = "capability_invalid_result";
    } else {
      reply = result.reply;
      for (let offset = 0; offset < reply.length; offset += MAX_DELTA_CHARS) {
        await emit({ kind: "delta", text: reply.slice(offset, offset + MAX_DELTA_CHARS) });
      }
    }
  } catch (error) {
    if (controller.signal.aborted || error?.code === "cancelled") {
      reason = "aborted";
    } else if (["not_granted", "grant_expired", "call_limit_exhausted"].includes(error?.code)) {
      reason = "failed";
      errorCode = "capability_denied";
    } else {
      reason = "failed";
      errorCode = "capability_failed";
    }
  }
  await emit({ kind: "done", reason, ...(errorCode === null ? {} : { code: errorCode }) });
  history.push({
    id,
    at: startedAt,
    message: truncateForHistory(message),
    reply: truncateForHistory(reply),
    reason: errorCode ?? reason
  });
  if (history.length > HISTORY_KEPT_TURNS) history.shift();
  inflightTurn = null;
  if (errorCode !== null) {
    await writeAtomically(`${responsesRoot}/response-${id}.json`, {
      schemaVersion: 1,
      id,
      ok: false,
      error: { code: errorCode }
    });
    return;
  }
  await writeAtomically(`${responsesRoot}/response-${id}.json`, {
    schemaVersion: 1,
    id,
    ok: true,
    result: { reply, reason, events: sequence }
  });
}

// Returns { respond } for an immediate outcome or { chat } to start a turn.
function dispatch(request) {
  if (!exactKeys(request, ["schemaVersion", "id", "method", "sessionToken", "params"])
    || request.schemaVersion !== 1 || request.sessionToken !== sessionToken) {
    // Generic rejection: no request material is echoed back.
    return { respond: { ok: false, error: { code: "invalid_request" } } };
  }
  if (request.method === "hello.say") {
    if (!exactKeys(request.params, ["name"]) || !printableText(request.params.name, 64)) {
      return { respond: { ok: false, error: { code: "invalid_request" } } };
    }
    return { respond: { ok: true, result: { greeting: `Hello, ${request.params.name}!` } } };
  }
  if (request.method === "chat.send") {
    if (!exactKeys(request.params, ["message"])
      || !printableText(request.params.message, MAX_MESSAGE_CHARS)) {
      return { respond: { ok: false, error: { code: "invalid_request" } } };
    }
    if (capabilityTransport === null) {
      return { respond: { ok: false, error: { code: "capability_unavailable" } } };
    }
    if (inflightTurn !== null) {
      return { respond: { ok: false, error: { code: "chat_busy" } } };
    }
    return { chat: { message: request.params.message } };
  }
  if (request.method === "chat.history") {
    if (!exactKeys(request.params, [])) {
      return { respond: { ok: false, error: { code: "invalid_request" } } };
    }
    return {
      respond: {
        ok: true,
        result: { turns: history.slice(-HISTORY_REPORTED_TURNS), total: history.length }
      }
    };
  }
  if (request.method === "chat.abort") {
    if (!exactKeys(request.params, ["target"]) || typeof request.params.target !== "string"
      || !TARGET_ID_PATTERN.test(request.params.target)) {
      return { respond: { ok: false, error: { code: "invalid_request" } } };
    }
    if (inflightTurn !== null && inflightTurn.id === request.params.target) {
      inflightTurn.controller.abort();
      return { respond: { ok: true, result: { aborted: true } } };
    }
    return { respond: { ok: true, result: { aborted: false } } };
  }
  return { respond: { ok: false, error: { code: "invalid_request" } } };
}

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
    const action = dispatch(request);
    if (action.chat) {
      runChatTurn(id, action.chat.message).catch(async () => {
        inflightTurn = null;
        try {
          await writeAtomically(`${responsesRoot}/response-${id}.json`, {
            schemaVersion: 1,
            id,
            ok: false,
            error: { code: "chat_failed" }
          });
        } catch { /* The client times out; the turn stays bounded. */ }
      });
      continue;
    }
    await writeAtomically(`${responsesRoot}/response-${id}.json`, {
      schemaVersion: 1,
      id,
      ...action.respond
    });
  }
}

await mkdir(requestsRoot, { recursive: true });
await mkdir(responsesRoot, { recursive: true });
await mkdir(eventsRoot, { recursive: true });
await writeAtomically(`${sessionRoot}/ready.json`, {
  schemaVersion: 1,
  protocol: PROTOCOL,
  sessionToken,
  capabilityTransport: capabilityTransport === null ? "none" : "filesystem-mailbox",
  startedAt: new Date().toISOString()
});
console.log(READY_LINE);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => process.exit(0));
}
// A single self-scheduling pass: scans never overlap, and an in-flight chat
// turn never blocks abort, history, or greeting requests.
const serve = () => {
  serveOnce()
    .catch(() => { /* The next poll retries; requests are idempotent. */ })
    .finally(() => setTimeout(serve, POLL_INTERVAL_MS));
};
serve();
