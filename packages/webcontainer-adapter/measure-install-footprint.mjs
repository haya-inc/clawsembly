import { lstat, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

async function measureTree(root) {
  const result = { root, bytes: 0, files: 0, directories: 0, symlinks: 0 };
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    result.directories += 1;
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
        continue;
      }
      const metadata = await lstat(target);
      result.bytes += metadata.size;
      if (entry.isSymbolicLink()) result.symlinks += 1;
      else result.files += 1;
    }
  }
  return result;
}

const nodeModules = await measureTree("node_modules");
const npmCache = await measureTree(path.join(homedir(), ".npm"));
console.log(JSON.stringify({ nodeModules, npmCache }));
