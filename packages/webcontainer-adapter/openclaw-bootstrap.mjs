import { installNodeSqlitePolyfill } from "./node-sqlite-polyfill.mjs";

await installNodeSqlitePolyfill();

const openclawEntry = new URL("../node_modules/openclaw/openclaw.mjs", import.meta.url);
process.argv = [process.execPath, openclawEntry.pathname, ...process.argv.slice(2)];
await import(openclawEntry.href);
