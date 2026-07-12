import assert from "node:assert/strict";
import test from "node:test";

import * as api from "./embed-manifest.mjs";

test("runtime entrypoint matches the declared public embed API", () => {
  assert.deepEqual(Object.keys(api).sort(), [
    "assertVerifiedLaunch",
    "bootVerifiedEmbed",
    "createArtifactStorageKey",
    "createEmbedManifest"
  ]);
  for (const value of Object.values(api)) assert.equal(typeof value, "function");
});
