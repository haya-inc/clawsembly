// Evaluates a published npm `engines.node` range against one concrete Node
// version. The BrowserPod lane deliberately accepts only the simple
// `>=major.minor(.patch)` form (browserpod-preflight.mjs) because its guest
// cannot satisfy anything else; the native-Gateway lane must evaluate the
// real upstream declarations, which are now compound
// (`>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0` at 2026.7.1-2). Unknown
// syntax fails closed rather than approximating.

const VERSION_PART = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/u;
const COMPARATOR = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/u;
const MAX_RANGE_LENGTH = 256;

export class NodeEngineRangeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeEngineRangeError";
    this.code = code;
  }
}

function parseVersion(value, { allowPartial = false } = {}) {
  const match = typeof value === "string" ? VERSION_PART.exec(value.trim()) : null;
  if (!match) {
    throw new NodeEngineRangeError("node_engine_range_unsupported", `unsupported version "${value}"`);
  }
  const segments = [match[1], match[2], match[3]].map((raw) =>
    raw === undefined || /^[xX*]$/u.test(raw) ? null : Number(raw));
  if (!allowPartial && segments.some((segment) => segment === null)) {
    throw new NodeEngineRangeError("node_engine_range_unsupported", `unsupported version "${value}"`);
  }
  const [major, minor, patch] = segments;
  return Object.freeze({
    major,
    minor: major === null ? null : minor,
    patch: major === null || minor === null ? null : patch
  });
}

function compare(version, target) {
  for (const part of ["major", "minor", "patch"]) {
    const left = version[part] ?? 0;
    const right = target[part] ?? 0;
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function comparatorSatisfied(version, raw) {
  const trimmed = raw.trim();
  if (trimmed === "*" || trimmed === "x" || trimmed === "X") return true;
  const match = COMPARATOR.exec(trimmed);
  if (!match) throw new NodeEngineRangeError("node_engine_range_unsupported", `unsupported comparator "${raw}"`);
  const operator = match[1] ?? "";
  const target = parseVersion(match[2], { allowPartial: true });
  if (operator === ">=") return compare(version, target) >= 0;
  if (operator === ">") return compare(version, target) > 0;
  if (operator === "<") return compare(version, target) < 0;
  if (operator === "<=") return compare(version, target) <= 0;
  if (operator === "^") {
    const upper = target.major > 0
      ? { major: target.major + 1, minor: 0, patch: 0 }
      : (target.minor ?? 0) > 0
        ? { major: 0, minor: (target.minor ?? 0) + 1, patch: 0 }
        : { major: 0, minor: 0, patch: (target.patch ?? 0) + 1 };
    return compare(version, target) >= 0 && compare(version, upper) < 0;
  }
  if (operator === "~") {
    const upper = target.minor === null
      ? { major: target.major + 1, minor: 0, patch: 0 }
      : { major: target.major, minor: target.minor + 1, patch: 0 };
    return compare(version, target) >= 0 && compare(version, upper) < 0;
  }
  // A bare version: omitted segments act as wildcards ("22" matches 22.x.x).
  if (target.major === null) return true;
  if (target.minor === null) return version.major === target.major;
  if (target.patch === null) return version.major === target.major && version.minor === target.minor;
  return compare(version, target) === 0;
}

/**
 * Returns true when `versionText` (an exact `major.minor.patch`) satisfies the
 * published `engines.node` range, supporting `||` alternatives, space-joined
 * comparator conjunctions, `>=|>|<|<=|=`, `^`, `~`, bare and wildcard
 * versions, and `a.b.c - x.y.z` hyphen ranges. Any other syntax throws
 * `node_engine_range_unsupported`; an empty or missing range throws
 * `node_engine_range_missing`.
 */
export function nodeEngineRangeSatisfies(versionText, rangeText) {
  const version = parseVersion(versionText);
  if (typeof rangeText !== "string" || rangeText.trim() === "") {
    throw new NodeEngineRangeError("node_engine_range_missing", "the artifact declares no Node engines range");
  }
  if (rangeText.length > MAX_RANGE_LENGTH) {
    throw new NodeEngineRangeError("node_engine_range_unsupported", "the Node engines range is unreasonably long");
  }
  for (const alternative of rangeText.split("||")) {
    const clause = alternative.trim();
    if (clause === "") throw new NodeEngineRangeError("node_engine_range_unsupported", "an empty range alternative");
    if (clause.includes(" - ")) {
      const bounds = clause.split(" - ").map((part) => part.trim());
      if (bounds.length !== 2) {
        throw new NodeEngineRangeError("node_engine_range_unsupported", `unsupported hyphen range "${clause}"`);
      }
      const lower = parseVersion(bounds[0], { allowPartial: true });
      const upper = parseVersion(bounds[1], { allowPartial: true });
      const upperInclusive = {
        major: upper.major,
        minor: upper.minor ?? 99_999,
        patch: upper.patch ?? 99_999
      };
      if (compare(version, lower) >= 0 && compare(version, upperInclusive) <= 0) return true;
      continue;
    }
    const comparators = clause.split(/\s+/u);
    if (comparators.every((comparator) => comparatorSatisfied(version, comparator))) return true;
  }
  return false;
}

/**
 * Fail-closed gate: throws `node_engine_unsatisfied` when the running version
 * does not satisfy the declared range, and re-throws range-syntax failures.
 */
export function assertNodeEngineSatisfied(versionText, rangeText) {
  if (!nodeEngineRangeSatisfies(versionText, rangeText)) {
    throw new NodeEngineRangeError(
      "node_engine_unsatisfied",
      `Node ${versionText} does not satisfy the required engines range "${rangeText}"`
    );
  }
  return Object.freeze({ version: versionText, range: rangeText, satisfied: true });
}
