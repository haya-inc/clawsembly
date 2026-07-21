import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 128 * 1024 * 1024;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILE_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_FILES = 2_048;
const MAX_SIGNAL_PATHS = 32;
const MAX_SCRIPT_COMMAND_CHARS = 4_096;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const PACKAGE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall"];
const SOURCE_PATTERN = /\.(?:cjs|js|jsx|mjs)$/u;
const NATIVE_PATTERN = /(?:^|\/)(?:binding\.gyp|[^/]+\.(?:dll|dylib|node|so))$/u;
const WASM_PATTERN = /\.wasm$/u;
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/gu;
const SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s*["']([^"']+)["']/gu;
const BUILTINS = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/u, "")]));
const NETWORK_BUILTINS = new Set(["dgram", "dns", "dns/promises", "http", "http2", "https", "net", "tls"]);
const NETWORK_PACKAGES = new Set([
  "@anthropic-ai/sdk",
  "@google/genai",
  "@mistralai/mistralai",
  "@modelcontextprotocol/sdk",
  "openai",
  "undici",
  "ws"
]);

function sorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function safePackPath(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/")
    && !/[\\\u0000-\u001f\u007f]/u.test(path)
    && !path.split("/").some((segment) => segment === ".." || segment === "");
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith("node:")) return specifier;
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function builtinName(specifier) {
  const normalized = specifier.replace(/^node:/u, "");
  return BUILTINS.has(specifier) || BUILTINS.has(normalized) ? normalized : undefined;
}

export function deriveBrowserCapabilities({ lifecycleScripts, nativeArtifacts, wasmArtifacts, nodeBuiltins, networkApis, sourceSignals }) {
  const capabilities = new Set();
  if (lifecycleScripts.length) capabilities.add("install-script");
  if (nativeArtifacts.length) capabilities.add("native-code");
  if (wasmArtifacts.length || nodeBuiltins.some((name) => name === "wasi")
    || sourceSignals.includes("WebAssembly")) capabilities.add("wasm");
  if (nodeBuiltins.some((name) => name === "fs" || name === "fs/promises")) capabilities.add("filesystem");
  if (nodeBuiltins.some((name) => NETWORK_BUILTINS.has(name)) || networkApis.length) capabilities.add("network");
  if (nodeBuiltins.some((name) => name === "child_process" || name === "cluster")) capabilities.add("subprocess");
  if (nodeBuiltins.some((name) => name === "crypto")) capabilities.add("cryptography");
  if (nodeBuiltins.some((name) => name === "sqlite")) capabilities.add("database");
  if (nodeBuiltins.some((name) => name === "worker_threads")) capabilities.add("workers");
  if (nodeBuiltins.some((name) => name === "tty" || name === "readline" || name === "readline/promises")) capabilities.add("terminal");
  if (nodeBuiltins.some((name) => name === "os")) capabilities.add("os");
  if (sourceSignals.includes("process.env")) capabilities.add("environment");
  return sorted(capabilities);
}

export function classifyDependencyPackage({ dependency, manifest = {}, files = [], scanTruncated = false }) {
  if (!PACKAGE_NAME_PATTERN.test(dependency?.name) || !dependency?.declaredSpec
    || !PACKAGE_VERSION_PATTERN.test(dependency?.resolvedVersion)
    || !INTEGRITY_PATTERN.test(dependency?.integrity)) {
    throw new TypeError("An exact dependency identity is required for risk classification.");
  }
  if (manifest.name !== dependency.name || manifest.version !== dependency.resolvedVersion) {
    throw new Error(`Packed dependency identity drift for ${dependency.name}.`);
  }
  const lifecycleScripts = LIFECYCLE_SCRIPTS.flatMap((name) => {
    const command = manifest.scripts?.[name];
    if (typeof command !== "string" || command.length === 0) return [];
    if (command.length > MAX_SCRIPT_COMMAND_CHARS) {
      throw new Error(`Dependency lifecycle script exceeds the report budget: ${dependency.name}.`);
    }
    return [{ name, command }];
  });
  const paths = files.map(({ path }) => path).filter(safePackPath);
  const allNativeArtifacts = sorted(paths.filter((path) => NATIVE_PATTERN.test(path)));
  const allWasmArtifacts = sorted(paths.filter((path) => WASM_PATTERN.test(path)));
  const nativeArtifacts = allNativeArtifacts.slice(0, MAX_SIGNAL_PATHS);
  const wasmArtifacts = allWasmArtifacts.slice(0, MAX_SIGNAL_PATHS);
  const nodeBuiltins = new Set();
  const networkApis = new Set();
  const sourceSignals = new Set();
  let sourceFileCount = 0;
  let sourceBytes = 0;

  for (const file of files) {
    if (typeof file.contents !== "string" || !SOURCE_PATTERN.test(file.path)) continue;
    sourceFileCount += 1;
    sourceBytes += Buffer.byteLength(file.contents);
    for (const pattern of [IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN]) {
      pattern.lastIndex = 0;
      for (const match of file.contents.matchAll(pattern)) {
        const specifier = match[1];
        const builtin = builtinName(specifier);
        if (builtin) nodeBuiltins.add(builtin);
        const packageName = packageNameFromSpecifier(specifier);
        if (NETWORK_PACKAGES.has(packageName)) networkApis.add(packageName);
      }
    }
    if (/\bfetch\s*\(/u.test(file.contents)) networkApis.add("fetch");
    if (/\bWebSocket\s*\(/u.test(file.contents)) networkApis.add("WebSocket");
    if (/\bEventSource\s*\(/u.test(file.contents)) networkApis.add("EventSource");
    if (/\bprocess\.env\b/u.test(file.contents)) sourceSignals.add("process.env");
    if (/\bWebAssembly\b/u.test(file.contents)) sourceSignals.add("WebAssembly");
  }

  const sortedBuiltins = sorted(nodeBuiltins);
  const sortedNetworkApis = sorted(networkApis);
  const sortedSourceSignals = sorted(sourceSignals);
  return {
    name: dependency.name,
    change: dependency.change,
    declaredSpec: dependency.declaredSpec,
    resolvedVersion: dependency.resolvedVersion,
    integrity: dependency.integrity,
    scan: {
      packageFileCount: files.length,
      sourceFileCount,
      sourceBytes,
      truncated: Boolean(scanTruncated || allNativeArtifacts.length > MAX_SIGNAL_PATHS
        || allWasmArtifacts.length > MAX_SIGNAL_PATHS)
    },
    signals: {
      lifecycleScripts,
      nativeArtifacts,
      wasmArtifacts,
      nodeBuiltins: sortedBuiltins,
      networkApis: sortedNetworkApis,
      sourceSignals: sortedSourceSignals,
      browserCapabilities: deriveBrowserCapabilities({
        lifecycleScripts,
        nativeArtifacts,
        wasmArtifacts,
        nodeBuiltins: sortedBuiltins,
        networkApis: sortedNetworkApis,
        sourceSignals: sortedSourceSignals
      })
    }
  };
}

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options
  });
}

// Windows cannot spawn npm's .cmd shim directly, so prefer the invoking npm's
// JS entry point (matches the release scripts' runNpm helper).
const npmCli = process.env.npm_execpath;
function runNpm(args, cwd) {
  if (npmCli && /\.[cm]?js$/u.test(npmCli)) return run(process.execPath, [npmCli, ...args], cwd);
  return run("npm", args, cwd, { shell: process.platform === "win32" });
}

export function inspectDependencyRisk(dependency) {
  if (!dependency?.resolvedVersion || !dependency?.integrity) {
    throw new Error(`Exact shrinkwrap identity is missing for ${dependency?.name ?? "dependency"}.`);
  }
  const workingDirectory = mkdtempSync(resolve(tmpdir(), "clawsembly-dependency-risk-"));
  try {
    const packed = JSON.parse(runNpm([
      "pack",
      "--json",
      "--ignore-scripts",
      "--",
      `${dependency.name}@${dependency.resolvedVersion}`
    ], workingDirectory))[0];
    if (packed?.name !== dependency.name || packed?.version !== dependency.resolvedVersion
      || packed?.integrity !== dependency.integrity) {
      throw new Error(`npm tarball identity drift for ${dependency.name}@${dependency.resolvedVersion}.`);
    }
    if (!Number.isSafeInteger(packed.size) || packed.size < 0
      || !Number.isSafeInteger(packed.unpackedSize) || packed.unpackedSize < 0
      || packed.size > MAX_TARBALL_BYTES || packed.unpackedSize > MAX_UNPACKED_BYTES
      || !Array.isArray(packed.files)) {
      throw new Error(`Dependency artifact exceeds the inspection budget: ${dependency.name}@${dependency.resolvedVersion}.`);
    }
    const packageFiles = packed.files
      .map((file) => ({ path: String(file.path), size: Number(file.size ?? 0) }))
      .filter((file) => {
        if (!safePackPath(file.path) || !Number.isSafeInteger(file.size) || file.size < 0) {
          throw new Error(`Dependency artifact contains an unsafe file: ${dependency.name}.`);
        }
        return true;
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const candidates = packageFiles.filter((file) => SOURCE_PATTERN.test(file.path));
    const selected = [];
    let selectedBytes = 0;
    for (const file of candidates) {
      if (selected.length >= MAX_SOURCE_FILES || file.size > MAX_SOURCE_FILE_BYTES
        || selectedBytes + file.size > MAX_SOURCE_BYTES) continue;
      selected.push(file);
      selectedBytes += file.size;
    }
    const scanTruncated = selected.length !== candidates.length;
    const extractionDirectory = resolve(workingDirectory, "extract");
    mkdirSync(extractionDirectory, { recursive: true });
    const requested = sorted(["package.json", ...selected.map(({ path }) => path)]);
    if (typeof packed.filename !== "string" || packed.filename.length === 0) {
      throw new Error(`npm omitted the dependency tarball path: ${dependency.name}.`);
    }
    const tarball = resolve(workingDirectory, packed.filename);
    if (!tarball.startsWith(`${workingDirectory}${sep}`) || !lstatSync(tarball).isFile()) {
      throw new Error(`npm returned an unsafe dependency tarball path: ${dependency.name}.`);
    }
    // tar receives cwd-relative paths (GNU tar parses the colon in an
    // absolute Windows path as a remote-host separator), and reads the member
    // list from a file because a large dependency can exceed the Windows
    // command-line length limit.
    writeFileSync(
      resolve(workingDirectory, "extract-list.txt"),
      requested.map((path) => `package/${path}`).join("\n"),
      "utf8"
    );
    run("tar", ["-xzf", packed.filename, "-C", "extract", "-T", "extract-list.txt"], workingDirectory);
    const packageRoot = realpathSync(resolve(extractionDirectory, "package"));
    const readSafe = (path) => {
      const filePath = resolve(packageRoot, path);
      if (!filePath.startsWith(`${packageRoot}${sep}`) || !lstatSync(filePath).isFile()
        || !realpathSync(filePath).startsWith(`${packageRoot}${sep}`)) {
        throw new Error(`Dependency extraction escaped its package root: ${dependency.name}.`);
      }
      return readFileSync(filePath, "utf8");
    };
    const manifest = JSON.parse(readSafe("package.json"));
    const selectedByPath = new Set(selected.map(({ path }) => path));
    const files = packageFiles.map((file) => ({
      ...file,
      ...(selectedByPath.has(file.path) ? { contents: readSafe(file.path) } : {})
    }));
    return classifyDependencyPackage({ dependency, manifest, files, scanTruncated });
  } finally {
    rmSync(workingDirectory, { recursive: true, force: true });
  }
}
