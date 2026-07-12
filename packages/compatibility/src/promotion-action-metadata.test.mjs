import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync(new URL("../../../actions/promotion-policy/action.yml", import.meta.url), "utf8");
const runner = readFileSync(new URL("../../../actions/promotion-policy/run.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../../examples/release-policy/github-actions.yml.example", import.meta.url), "utf8");

test("promotion policy Action is dependency-free and exposes stable outputs", () => {
  assert.match(action, /runs:\n\s+using: node24\n\s+main: run\.mjs/u);
  for (const output of ["decision", "candidate_version", "reasons"]) {
    assert.match(action, new RegExp(`\\n  ${output}:\\n`, "u"));
  }
  assert.match(action, /default: observe/u);
  assert.match(action, /default: https:\/\/haya-inc\.github\.io\/clawsembly\/data\/promotion-policy\.json/u);
  assert.match(runner, /\.\.\/\.\.\/examples\/release-policy\/check\.mjs/u);
  assert.doesNotMatch(runner, /@actions\//u);
  assert.match(workflow, /uses: haya-inc\/clawsembly\/actions\/promotion-policy@main\n/u);
  assert.match(workflow, /mode: observe/u);
});
