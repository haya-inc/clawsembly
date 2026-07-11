import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const IMPORT_MARKER = 'import crypto from "node:crypto";';
const VERIFY_MARKER = 'return crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);';
const VERIFY_TAIL_MARKER = `${VERIFY_MARKER}\n\t} catch {\n\t\treturn false;\n\t}`;
const FALLBACK_IMPORT = 'import { verifyEd25519WithNoble } from "../../../adapter/ed25519-verify-adapter.mjs";';

export function patchOpenClawEd25519Source(source) {
  if (source.includes(FALLBACK_IMPORT)) return source;
  if (!source.includes(IMPORT_MARKER) || !source.includes(VERIFY_TAIL_MARKER)) {
    throw new Error("OpenClaw Ed25519 verifier markers changed; refusing to patch");
  }
  return source
    .replace(IMPORT_MARKER, `${IMPORT_MARKER}\n${FALLBACK_IMPORT}`)
    .replace(
      VERIFY_TAIL_MARKER,
      `let nativeValid = false;\n\t\ttry { nativeValid = crypto.verify(null, Buffer.from(payload, "utf8"), key, sig); } catch {}\n\t\treturn nativeValid || verifyEd25519WithNoble(Buffer.from(payload, "utf8"), publicKey, sig);\n\t} catch {\n\t\treturn verifyEd25519WithNoble(Buffer.from(payload, "utf8"), publicKey, signatureBase64Url);\n\t}`
    );
}

export function patchInstalledOpenClaw(root = process.cwd()) {
  const dist = path.join(root, "node_modules", "openclaw", "dist");
  const candidates = fs.readdirSync(dist).filter((name) => name.startsWith("device-identity-") && name.endsWith(".js"));
  const patchedTargets = [];
  let changed = false;
  for (const name of candidates) {
    const target = path.join(dist, name);
    const source = fs.readFileSync(target, "utf8");
    if (!source.includes(VERIFY_TAIL_MARKER) && !source.includes(FALLBACK_IMPORT)) continue;
    const patched = patchOpenClawEd25519Source(source);
    if (patched !== source) {
      fs.writeFileSync(target, patched);
      changed = true;
    }
    patchedTargets.push(path.relative(root, target));
  }
  if (patchedTargets.length === 0) throw new Error("OpenClaw Ed25519 verifier module was not found");
  return { target: patchedTargets[0], targets: patchedTargets, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = patchInstalledOpenClaw();
  console.log(JSON.stringify({ adapter: "ed25519-noble-fallback", ...result, result: "pass" }));
}
