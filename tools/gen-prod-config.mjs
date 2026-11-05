// Builds the gitignored wrangler.prod.local.jsonc from wrangler.jsonc plus the
// real resource ids in .prod-ids.json: { "d1": "<database_id>", "kv": "<kv id>" }
import { readFileSync, writeFileSync } from "node:fs";

// Ids come from .prod-ids.json locally, or D1_ID / KV_ID env vars in CI.
let ids = { d1: process.env.D1_ID, kv: process.env.KV_ID };
if (!ids.d1 || !ids.kv) ids = JSON.parse(readFileSync(".prod-ids.json", "utf8"));
if (!ids.d1 || !ids.kv) throw new Error("need d1 and kv ids (.prod-ids.json or D1_ID/KV_ID)");

let cfg = readFileSync("wrangler.jsonc", "utf8");
const d1 = cfg.replace('"binding": "DB",', `"binding": "DB",\n      "database_id": "${ids.d1}",`);
const out = d1.replace('{ "binding": "CACHE" }', `{ "binding": "CACHE", "id": "${ids.kv}" }`);
if (out === cfg || d1 === cfg) throw new Error("wrangler.jsonc layout changed; update this script");
writeFileSync("wrangler.prod.local.jsonc", out);
console.log("wrote wrangler.prod.local.jsonc");
