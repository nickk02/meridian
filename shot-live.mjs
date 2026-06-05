import { chromium } from "playwright";
await new Promise(r => setTimeout(r, 150000)); // let Workers Build deploy
const b = await chromium.launch({ channel: "msedge" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("https://meridian.calm-butterfly-4753.workers.dev/", { waitUntil: "networkidle" });
await p.waitForTimeout(3500);
await p.getByText("MAP", { exact: true }).first().click().catch(() => {});
await p.waitForTimeout(7000);
await p.screenshot({ path: "globe-live.png" });
await b.close();
console.log("live shot saved");
