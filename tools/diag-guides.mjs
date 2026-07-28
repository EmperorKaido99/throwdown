// Renders the punch trajectory guides in isolation so they can be eyeballed
// without needing a webcam, a calibrated player, or a live run.
//
// The guides are the one part of the harness whose correctness is purely
// visual — a wrong-handed or wrong-direction arrow would teach the player the
// wrong movement and quietly corrupt the confusion matrix.

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const OUT = process.argv[2] ?? "tools/out/punch-guides.png";
const STANCE = process.env.STANCE ?? "orthodox";

const browser = await chromium.launch({ channel: "chrome", headless: false });
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
const page = await context.newPage();
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(`${BASE}/?guides=1`, {
  waitUntil: "domcontentloaded",
});
if (STANCE === "southpaw") {
  await page.selectOption("select", "southpaw");
}

await page.waitForTimeout(1500);
await page.screenshot({ path: OUT });
console.log(`saved ${OUT} (stance=${STANCE})`);
await browser.close();
