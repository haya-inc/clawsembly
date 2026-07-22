// Remote Gateway cockpit (ADR 0006, wrap deliverable 2): "connect your
// OpenClaw". The page drives the packed SDK's remote-gateway subpath —
// generated version-locked client, persistent browser device identity,
// encrypted device-token vault — against a Gateway the user operates.
// Interoperability only: nothing runs browser-locally and no evidence
// class is produced. All dynamic strings render through textContent.
import {
  connectRemoteOpenClawGateway,
  createRemoteGatewayConnection
} from "../../../packages/embed-sdk/remote-gateway.mjs";
import { OPENCLAW_GATEWAY_CONTRACT } from "../../../packages/embed-sdk/openclaw-gateway-contract.generated.mjs";

const SESSION_KEY = "cockpit";
const AUDIT_LIMIT = 200;

const query = (selector) => document.querySelector(selector);
const urlInput = query("#gateway-url");
const tokenInput = query("#gateway-token");
const deviceManagementInput = query("#device-management");
const devicesPanel = query("[data-devices-panel]");
const devicesList = query("[data-devices-list]");
const devicesRefreshButton = query("#devices-refresh");
const connectButton = query("#connect");
const disconnectButton = query("#disconnect");
const clearTokenButton = query("#clear-device-token");
const sendButton = query("#chat-send");
const abortButton = query("#chat-abort");
const historyButton = query("#chat-history");
const messageInput = query("#chat-message");
const chatLog = query("[data-chat-log]");
const auditLog = query("[data-audit-log]");
const connectError = query("[data-connect-error]");
const pairingPanel = query("[data-pairing]");

query("[data-page-origin]").textContent = globalThis.location.origin;
query("[data-contract-version]").textContent =
  `${OPENCLAW_GATEWAY_CONTRACT.artifact.package}@${OPENCLAW_GATEWAY_CONTRACT.artifact.version}`;

let client;
let unsubscribeChat;
let lastRunId;
const runEntries = new Map();

function setState(value) {
  query("[data-state]").textContent = value;
}

function setConnectedControls(connected) {
  connectButton.disabled = connected;
  disconnectButton.disabled = !connected;
  sendButton.disabled = !connected;
  abortButton.disabled = !connected;
  historyButton.disabled = !connected;
  clearTokenButton.disabled = client === undefined;
}

function showConnectError(lines) {
  connectError.hidden = lines.length === 0;
  connectError.textContent = lines.join("\n");
}

function appendAudit(entry) {
  const line = document.createElement("div");
  line.textContent = JSON.stringify(entry);
  auditLog.append(line);
  while (auditLog.childElementCount > AUDIT_LIMIT) auditLog.firstElementChild.remove();
  auditLog.scrollTop = auditLog.scrollHeight;
}

function runEntry(runId) {
  let entry = runEntries.get(runId);
  if (entry) return entry;
  const article = document.createElement("article");
  const head = document.createElement("div");
  head.className = "chat-run-state";
  head.textContent = `run ${runId} — started`;
  const body = document.createElement("pre");
  article.append(head, body);
  chatLog.append(article);
  chatLog.scrollTop = chatLog.scrollHeight;
  entry = { head, body, runId };
  runEntries.set(runId, entry);
  return entry;
}

function renderChatEvent(event) {
  const entry = runEntry(event.runId);
  if (event.state === "delta" && typeof event.deltaText === "string") {
    if (event.replace === true) entry.body.textContent = event.deltaText;
    else entry.body.textContent += event.deltaText;
  } else if (event.state !== "delta") {
    entry.head.textContent = `run ${event.runId} — ${event.state}`
      + (event.errorMessage ? `: ${event.errorMessage}` : "");
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderHello(hello) {
  query("[data-server]").textContent =
    `openclaw@${hello.server.version} (protocol ${hello.protocol})`;
  query("[data-authenticated]").textContent = hello.auth.authenticatedWith
    + (hello.auth.deviceTokenIssued ? " (new device token issued)" : "");
  query("[data-scopes]").textContent = hello.auth.scopes.join(", ");
  query("[data-surface]").textContent =
    `${hello.features.methods.length} methods, ${hello.features.events.length} events`;
}

function renderPairing(pairing) {
  pairingPanel.hidden = pairing === undefined;
  if (!pairing) return;
  query("[data-pairing-request]").textContent = pairing.requestId ?? "(not named by the Gateway)";
  query("[data-pairing-device]").textContent = pairing.deviceId ?? "(not named by the Gateway)";
  query("[data-pairing-reason]").textContent =
    `${pairing.reason} — requesting ${pairing.role} with ${pairing.scopes.join(", ")}`;
}

function deviceActionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    void handler().finally(() => { button.disabled = false; });
  });
  return button;
}

async function refreshDevices() {
  if (!client?.deviceManagement) return;
  let listing;
  try {
    listing = await client.devices.list();
  } catch (error) {
    appendAudit({ action: "cockpit-devices-list", outcome: "failed", reason: error?.code ?? "unknown" });
    return;
  }
  devicesList.replaceChildren();
  const renderEntry = (title, lines, actions) => {
    const article = document.createElement("article");
    const head = document.createElement("div");
    head.className = "chat-run-state";
    head.textContent = title;
    const body = document.createElement("pre");
    body.textContent = lines.join("\n");
    article.append(head, body, ...actions);
    devicesList.append(article);
  };
  for (const pendingEntry of listing.pending) {
    const requestId = pendingEntry.requestId;
    renderEntry(
      `pending pairing ${requestId ?? "(no request id)"}`,
      [
        `device: ${pendingEntry.deviceId ?? "?"}`,
        `role: ${pendingEntry.role ?? "?"} scopes: ${(pendingEntry.scopes ?? []).join(", ")}`
      ],
      requestId
        ? [
          deviceActionButton("Approve", async () => {
            try {
              await client.devices.approve({ requestId });
              appendAudit({ action: "cockpit-devices-approve", outcome: "succeeded" });
            } catch (error) {
              appendAudit({ action: "cockpit-devices-approve", outcome: "failed", reason: error?.code ?? "unknown" });
            }
            await refreshDevices();
          }),
          deviceActionButton("Reject", async () => {
            try {
              await client.devices.reject({ requestId });
              appendAudit({ action: "cockpit-devices-reject", outcome: "succeeded" });
            } catch (error) {
              appendAudit({ action: "cockpit-devices-reject", outcome: "failed", reason: error?.code ?? "unknown" });
            }
            await refreshDevices();
          })
        ]
        : []
    );
  }
  for (const device of listing.paired) {
    const role = device.role ?? "operator";
    renderEntry(
      `paired ${device.deviceId.slice(0, 12)}…${device.deviceId.slice(-8)}`,
      [
        `client: ${device.clientId ?? "?"} (${device.clientMode ?? "?"}) on ${device.platform ?? "?"}`,
        `role: ${role} scopes: ${(device.scopes ?? []).join(", ")}`,
        `last seen: ${device.lastSeenAtMs ? new Date(device.lastSeenAtMs).toISOString() : "?"} (${device.lastSeenReason ?? "?"})`
      ],
      [
        deviceActionButton("Rotate token", async () => {
          try {
            const rotated = await client.devices.rotateToken({ deviceId: device.deviceId, role });
            appendAudit({ action: "cockpit-devices-rotate", outcome: "succeeded", rotatedAtMs: rotated.rotatedAtMs });
          } catch (error) {
            appendAudit({ action: "cockpit-devices-rotate", outcome: "failed", reason: error?.code ?? "unknown" });
          }
          await refreshDevices();
        }),
        deviceActionButton("Revoke token", async () => {
          try {
            const revoked = await client.devices.revokeToken({ deviceId: device.deviceId, role });
            appendAudit({ action: "cockpit-devices-revoke", outcome: "succeeded", revokedAtMs: revoked.revokedAtMs });
          } catch (error) {
            appendAudit({ action: "cockpit-devices-revoke", outcome: "failed", reason: error?.code ?? "unknown" });
          }
          await refreshDevices();
        }),
        deviceActionButton("Remove pairing", async () => {
          try {
            await client.devices.remove({ deviceId: device.deviceId });
            appendAudit({ action: "cockpit-devices-remove", outcome: "succeeded" });
          } catch (error) {
            appendAudit({ action: "cockpit-devices-remove", outcome: "failed", reason: error?.code ?? "unknown" });
          }
          await refreshDevices();
        })
      ]
    );
  }
}

async function refreshDeviceTokenStatus() {
  if (!client) return;
  try {
    const metadata = await client.deviceAuth.metadata();
    query("[data-device-token]").textContent = metadata
      ? `encrypted, scopes ${metadata.scopes.join(", ")}`
      : "none";
  } catch {
    query("[data-device-token]").textContent = "unavailable";
  }
}

function explainConnectFailure(error) {
  const lines = [`Connect failed: ${error?.code ?? "unknown"}`];
  if (error?.gatewayCode) lines.push(`Gateway said: ${error.gatewayCode}`);
  if (error?.code === "server_version_mismatch") {
    lines.push("This Gateway runs a different OpenClaw version than the verified"
      + ` contract (${OPENCLAW_GATEWAY_CONTRACT.artifact.version}). The client is`
      + " version-locked by design and will not negotiate down.");
  }
  if (error?.code === "connect_rejected") {
    lines.push("If the Gateway names gateway.controlUi.allowedOrigins, add this"
      + ` page's exact origin (${globalThis.location.origin}) to that allowlist`
      + " in your Gateway configuration and reconnect.");
  }
  if (error?.code === "origin_not_allowed") {
    lines.push("This page's origin is not in the connection material's own"
      + " allowlist — rebuild the material with the current origin.");
  }
  return lines;
}

async function connect() {
  showConnectError([]);
  renderPairing(undefined);
  let material;
  try {
    material = createRemoteGatewayConnection({
      url: urlInput.value.trim(),
      token: tokenInput.value,
      allowedOrigins: [globalThis.location.origin]
    });
  } catch (error) {
    showConnectError([error instanceof Error ? error.message : "invalid connection input"]);
    return;
  }
  connectButton.disabled = true;
  setState("connecting");
  try {
    client = connectRemoteOpenClawGateway({
      connection: material,
      deviceManagement: deviceManagementInput.checked,
      onAudit: appendAudit
    });
    unsubscribeChat = client.chat.onEvent(renderChatEvent);
    const hello = await client.connect();
    renderHello(hello);
    setState(client.state);
    setConnectedControls(true);
    devicesPanel.hidden = !client.deviceManagement;
    await refreshDeviceTokenStatus();
    await refreshDevices();
  } catch (error) {
    setState(client?.state ?? "failed");
    setConnectedControls(false);
    connectButton.disabled = false;
    renderPairing(error?.pairing);
    showConnectError(explainConnectFailure(error));
    await refreshDeviceTokenStatus();
  }
}

function disconnect() {
  unsubscribeChat?.();
  unsubscribeChat = undefined;
  client?.close();
  setState(client?.state ?? "closed");
  setConnectedControls(false);
  connectButton.disabled = false;
  devicesPanel.hidden = true;
  devicesList.replaceChildren();
}

async function sendChat() {
  if (!client) return;
  const message = messageInput.value.trim();
  if (!message) return;
  sendButton.disabled = true;
  try {
    const ack = await client.chat.send({ sessionKey: SESSION_KEY, message, timeoutMs: 60_000 });
    lastRunId = ack.runId;
    runEntry(ack.runId).head.textContent = `run ${ack.runId} — ${ack.status}`;
  } catch (error) {
    appendAudit({ action: "cockpit-chat-send", outcome: "failed", reason: error?.code ?? "unknown" });
  } finally {
    sendButton.disabled = client === undefined || client.state !== "ready";
  }
}

async function abortChat() {
  if (!client) return;
  try {
    const result = await client.chat.abort({
      sessionKey: SESSION_KEY,
      ...(lastRunId === undefined ? {} : { runId: lastRunId })
    });
    appendAudit({
      action: "cockpit-chat-abort",
      outcome: result.aborted ? "aborted" : "nothing-to-abort",
      runIds: result.runIds.length
    });
  } catch (error) {
    appendAudit({ action: "cockpit-chat-abort", outcome: "failed", reason: error?.code ?? "unknown" });
  }
}

async function loadHistory() {
  if (!client) return;
  try {
    const history = await client.chat.history({ sessionKey: SESSION_KEY, limit: 50 });
    const article = document.createElement("article");
    const head = document.createElement("div");
    head.className = "chat-run-state";
    head.textContent = `history — ${history.messages.length} message(s)`;
    const body = document.createElement("pre");
    body.textContent = JSON.stringify(history.messages, null, 1);
    article.append(head, body);
    chatLog.append(article);
    chatLog.scrollTop = chatLog.scrollHeight;
  } catch (error) {
    appendAudit({ action: "cockpit-chat-history", outcome: "failed", reason: error?.code ?? "unknown" });
  }
}

async function clearDeviceToken() {
  if (!client) return;
  try {
    const cleared = await client.deviceAuth.clear();
    appendAudit({ action: "cockpit-device-token", outcome: cleared ? "cleared" : "unchanged" });
  } catch (error) {
    appendAudit({ action: "cockpit-device-token", outcome: "failed", reason: error?.code ?? "unknown" });
  }
  await refreshDeviceTokenStatus();
}

connectButton.addEventListener("click", () => { void connect(); });
disconnectButton.addEventListener("click", disconnect);
devicesRefreshButton.addEventListener("click", () => { void refreshDevices(); });
sendButton.addEventListener("click", () => { void sendChat(); });
abortButton.addEventListener("click", () => { void abortChat(); });
historyButton.addEventListener("click", () => { void loadHistory(); });
clearTokenButton.addEventListener("click", () => { void clearDeviceToken(); });
