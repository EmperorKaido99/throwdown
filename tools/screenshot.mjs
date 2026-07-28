// Captures a screenshot of the running app for visual verification that
// landmarks are actually being drawn — Milestone 0's done-when is "visibly
// tracked and overlaid", which no counter can confirm on its own.

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const OUT = process.argv[2] ?? "tools/out/milestone0.png";

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});
const context = await browser.newContext({
  permissions: ["camera"],
  viewport: { width: 1360, height: 800 },
});
const page = await context.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.bringToFront();
await page.getByRole("button", { name: /enable camera/i }).click();
await page.waitForFunction(
  () => window.__shadowboxPerf?.().poseStatus === "ready",
  { timeout: 90_000 }
);

// Keep the compositor awake so the overlay is actually painted.
await page.evaluate(() => {
  const tick = () => requestAnimationFrame(tick);
  requestAnimationFrame(tick);
});
await page.waitForTimeout(8000);

await page.screenshot({ path: OUT });
const perf = await page.evaluate(() => window.__shadowboxPerf());
console.log(`Saved ${OUT}`);
console.log(
  `body found in ${(perf.poseFoundRatio * 100).toFixed(0)}% of frames, ` +
    `median interval ${perf.frameInterval.median.toFixed(1)}ms`
);

await browser.close();
