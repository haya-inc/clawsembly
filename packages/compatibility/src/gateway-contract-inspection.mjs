import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { basename, dirname } from "node:path";

const PUBLIC_DECLARATION_PATH = "dist/gateway/protocol/index.d.ts";
const PUBLIC_RUNTIME_PATH = "dist/gateway/protocol/index.js";
const SERVER_METHODS_PATTERN = /^dist\/server-methods-(?!list-)[A-Za-z0-9_-]+\.js$/u;
const METHOD_POLICY_PATTERN = /^dist\/core-method-policy-[A-Za-z0-9_-]+\.mjs$/u;
const VERSION_MODULE_PATTERN = /\bfrom\s*["']\.\.\/\.\.\/(version-[A-Za-z0-9_-]+\.m?js)["']/gu;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

const sha256 = (source) => `sha256-${createHash("sha256").update(source).digest("hex")}`;
const sorted = (values) => [...new Set(values)].sort((left, right) => left.localeCompare(right));

function safePackPath(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/")
    && !/[\\\u0000-\u001f\u007f]/u.test(path)
    && !path.split("/").some((segment) => segment === "" || segment === "..");
}

function sourceRecord(path, source) {
  return typeof source === "string" ? { path, sha256: sha256(source) } : null;
}

export function declarationExports(source) {
  if (typeof source !== "string") return [];
  const names = [];
  for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}\s*;?/gu)) {
    for (const raw of match[1].split(",")) {
      const exported = raw.trim().replace(/^type\s+/u, "").split(/\s+as\s+/u).at(-1)?.trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exported ?? "")) names.push(exported);
    }
  }
  for (const match of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:class|const|enum|function|interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gu
  )) {
    names.push(match[1]);
  }
  return sorted(names);
}

function coreMethods(source) {
  if (typeof source !== "string") return [];
  const methods = [];
  for (const match of source.matchAll(
    /\bcreateLazyCoreHandlers\s*\(\s*\{[\s\S]*?\bmethods\s*:\s*\[([\s\S]*?)\]/gu
  )) {
    for (const literal of match[1].matchAll(/["']([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*)["']/gu)) {
      methods.push(literal[1]);
    }
  }
  return sorted(methods);
}

// Newer bundles keep the core catalog as tuples of [method, family, scope, ...].
// Read every tuple or reject the table. Policy objects can contain nested arrays.
function catalogMethods(source) {
  if (typeof source !== "string") return [];
  const table = /\bconst\s+CORE_GATEWAY_METHOD_SPECS\s*=\s*\[/u.exec(source);
  if (!table) return [];
  const row = /\s*\[\s*(["'`])([a-z][a-zA-Z0-9_.-]*)\1\s*,/yu;
  const brackets = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|\[|\]|[/"'`]/gu;
  const separator = /\s*(,\s*(?=\[)|,?\s*\]\s*;)/yu;
  const methods = [];
  row.lastIndex = table.index + table[0].length;
  let name;
  while ((name = row.exec(source))) {
    brackets.lastIndex = row.lastIndex;
    let depth = 1;
    while (depth > 0) {
      const token = brackets.exec(source)?.[0];
      if (!token || /^[/"'`]$/u.test(token) || (token.startsWith("`") && token.includes("${"))) return [];
      if (token === "[") depth++;
      if (token === "]") depth--;
    }
    methods.push(name[2]);
    separator.lastIndex = brackets.lastIndex;
    const end = separator.exec(source);
    if (!end) return [];
    if (end[1].endsWith(";")) return sorted(methods);
    row.lastIndex = separator.lastIndex;
  }
  return [];
}

function protocolConstant(source, name) {
  if (typeof source !== "string") return null;
  const match = source.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(\\d+)\\s*;`, "u"));
  return match ? Number(match[1]) : null;
}

export function classifyGatewayContract({
  declarationSource,
  runtimeSource,
  versionSource,
  serverMethodsSource,
  serverMethodsPath = null,
  versionModulePath = null,
  legacyPluginDeclarationCount = 0,
  limitations = []
} = {}) {
  const usesCatalog = METHOD_POLICY_PATTERN.test(serverMethodsPath ?? "");
  const runtimeOnly = !declarationSource && usesCatalog && versionModulePath?.endsWith(".mjs");
  const exports = declarationExports(runtimeOnly ? runtimeSource : declarationSource);
  const schemaExports = exports.filter((name) => name.endsWith("Schema"));
  const validators = exports.filter((name) => name.startsWith("validate"));
  const eventSchemas = schemaExports.filter((name) => name.endsWith("EventSchema"));
  const methods = usesCatalog ? catalogMethods(serverMethodsSource) : coreMethods(serverMethodsSource);
  const protocol = {
    current: protocolConstant(versionSource, "PROTOCOL_VERSION"),
    minClient: protocolConstant(versionSource, "MIN_CLIENT_PROTOCOL_VERSION"),
    minProbe: protocolConstant(versionSource, "MIN_PROBE_PROTOCOL_VERSION"),
    minNode: protocolConstant(versionSource, "MIN_NODE_PROTOCOL_VERSION")
  };
  const findings = [...limitations];
  if (!declarationSource && !runtimeOnly) findings.push("public-declaration-missing");
  if (runtimeOnly && /\bexport\s*\*\s*from\b/u.test(runtimeSource)) findings.push("public-runtime-star-reexport");
  if (!runtimeSource) findings.push("public-runtime-entry-missing");
  if (!versionSource) findings.push("version-module-missing");
  if (!serverMethodsSource) findings.push("server-methods-source-missing");
  if (protocol.current === null || protocol.minClient === null || protocol.minProbe === null) {
    findings.push("protocol-constants-incomplete");
  }
  if (schemaExports.length === 0) findings.push("schema-exports-empty");
  if (validators.length === 0) findings.push("validators-empty");
  if (methods.length === 0) findings.push("core-methods-empty");
  const uniqueFindings = sorted(findings);
  return {
    inspection: {
      status: uniqueFindings.length === 0 ? "complete" : "incomplete",
      limitations: uniqueFindings
    },
    protocol,
    distribution: {
      legacyPluginDeclarationCount
    },
    inventories: {
      coreMethods: methods,
      schemaExports,
      validators,
      eventSchemas
    },
    sources: {
      publicDeclaration: sourceRecord(PUBLIC_DECLARATION_PATH, declarationSource),
      publicRuntime: sourceRecord(PUBLIC_RUNTIME_PATH, runtimeSource),
      versionModule: versionModulePath ? sourceRecord(versionModulePath, versionSource) : null,
      serverMethods: serverMethodsPath ? sourceRecord(serverMethodsPath, serverMethodsSource) : null
    }
  };
}

function readTarEntry(tarball, path, fileMap) {
  const metadata = fileMap.get(path);
  if (!metadata || metadata.size > MAX_SOURCE_BYTES) return undefined;
  // tar receives the bare filename relative to its cwd: GNU tar parses the
  // colon in an absolute Windows path as a remote-host separator.
  return execFileSync("tar", ["-xOzf", basename(tarball), `package/${path}`], {
    cwd: dirname(tarball),
    encoding: "utf8",
    maxBuffer: MAX_SOURCE_BYTES + 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export function inspectGatewayContract({ tarball, pack }) {
  if (typeof tarball !== "string" || !lstatSync(tarball).isFile() || !Array.isArray(pack?.files)) {
    throw new TypeError("An exact packed OpenClaw artifact is required for Gateway contract inspection.");
  }
  const fileMap = new Map();
  for (const file of pack.files) {
    const path = String(file.path);
    const size = Number(file.size ?? 0);
    if (!safePackPath(path) || !Number.isSafeInteger(size) || size < 0 || fileMap.has(path)) {
      throw new Error("OpenClaw artifact contains an unsafe Gateway inspection path.");
    }
    fileMap.set(path, { size });
  }
  const limitations = [];
  const declarationSource = readTarEntry(tarball, PUBLIC_DECLARATION_PATH, fileMap);
  const runtimeSource = readTarEntry(tarball, PUBLIC_RUNTIME_PATH, fileMap);
  if (fileMap.has(PUBLIC_DECLARATION_PATH) && !declarationSource) limitations.push("public-declaration-unreadable");
  const versionNames = new Set(Array.from(runtimeSource?.matchAll(VERSION_MODULE_PATTERN) ?? [], (match) => match[1]));
  const [versionName] = versionNames.size === 1 ? versionNames : [];
  if (versionNames.size > 1) limitations.push("version-module-reference-ambiguous");
  if (runtimeSource && !versionNames.size) limitations.push("version-module-reference-missing");
  const versionModulePath = versionName ? `dist/${versionName}` : null;
  const methodPattern = versionName?.endsWith(".mjs") ? METHOD_POLICY_PATTERN : SERVER_METHODS_PATTERN;
  const serverMethodPaths = [...fileMap.keys()].filter((path) => methodPattern.test(path));
  if (serverMethodPaths.length !== 1) limitations.push("server-methods-source-ambiguous");
  const serverMethodsPath = serverMethodPaths.length === 1 ? serverMethodPaths[0] : null;
  const serverMethodsSource = serverMethodsPath ? readTarEntry(tarball, serverMethodsPath, fileMap) : undefined;
  const versionSource = versionModulePath ? readTarEntry(tarball, versionModulePath, fileMap) : undefined;
  const legacyPluginDeclarationCount = [...fileMap.keys()].filter((path) =>
    path.endsWith(".d.ts") && (path.startsWith("dist/plugin-sdk/packages/gateway-protocol/")
      || path.startsWith("dist/plugin-sdk/packages/gateway-client/"))
  ).length;
  return classifyGatewayContract({
    declarationSource,
    runtimeSource,
    versionSource,
    serverMethodsSource,
    serverMethodsPath,
    versionModulePath,
    legacyPluginDeclarationCount,
    limitations
  });
}
