import crypto from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function readRawEd25519PublicKey(key) {
  if (typeof key === "string" && !key.includes("BEGIN")) {
    const normalized = key.replaceAll("-", "+").replaceAll("_", "/");
    const raw = Buffer.from(normalized + "=".repeat((4 - normalized.length % 4) % 4), "base64");
    return raw.byteLength === 32 ? raw : undefined;
  }
  const publicKey = key?.type === "public" && typeof key.export === "function" ? key : crypto.createPublicKey(key);
  if (publicKey.asymmetricKeyType !== "ed25519") return undefined;
  const der = Buffer.from(publicKey.export({ type: "spki", format: "der" }));
  if (der.byteLength !== ED25519_SPKI_PREFIX.byteLength + 32
    || !der.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)) return undefined;
  return der.subarray(ED25519_SPKI_PREFIX.byteLength);
}

export function verifyEd25519WithNoble(data, key, signature) {
  const rawPublicKey = readRawEd25519PublicKey(key);
  if (!rawPublicKey) return false;
  try {
    const signatureBytes = typeof signature === "string"
      ? Buffer.from(signature.replaceAll("-", "+").replaceAll("_", "/"), "base64")
      : Buffer.from(signature);
    return ed25519.verify(signatureBytes, Buffer.from(data), rawPublicKey);
  } catch {
    return false;
  }
}
