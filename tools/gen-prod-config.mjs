// Builds the gitignored wrangler.prod.local.jsonc from wrangler.jsonc plus the
// real resource ids in .prod-ids.json: { "d1": "<database_id>", "kv": "<kv id>" }
import { readFileSync, writeFileSync } from "node:fs";

const ids = JSON.parse(readFileSync(".prod-ids.json", "utf8"));
if (!ids.d1 || !ids.kv) throw new Error(".prod-ids.json needs d1 and kv");

let cfg = readFileSync("wrangler.jsonc", "utf8");
const d1 = cfg.replace('"binding": "DB",', `"binding": "DB",\n      "database_id": "${ids.d1}",`);
const out = d1.replace('{ "binding": "CACHE" }', `{ "binding": "CACHE", "id": "${ids.kv}" }`);
if (out === cfg || d1 === cfg) throw new Error("wrangler.jsonc layout changed; update this script");
writeFileSync("wrangler.prod.local.jsonc", out);
console.log("wrote wrangler.prod.local.jsonc");
