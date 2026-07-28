// Smoke-tests the Milestone 1 harness: loads the app, runs calibration against
// the live webcam, and screenshots the free-practice screen.
//
// This verifies the harness works end to end. It cannot verify classification
// accuracy — that needs a person throwing labelled punches, which is exactly
// what the guided protocol in the app is for.

import { chromium } from "playwright-core";

/** The main menu sits in front of the harness; deep-link straight to it. */
function withScreen(u) {
  const url = new globalThis.URL(u);
  url.searchParams.set("screen", "train");
  return url.toString();
}


const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const OUT = process.argv[2] ?? "tools/out/milestone1.png";
const URL = withScreen(process.env.MEASURE_URL ?? BASE + "/");

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
  viewport: { width: 1400, height: 900 },
});
const page = await context.newPage();
page.on("console", (m) => {
  if (/error|fail/i.test(m.text())) console.log(`  [browser] ${m.text()}`);
});
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });
await page.bringToFront();
await page.getByRole("button", { name: /enable camera/i }).click();
await page.waitForFunction(
  () => window.__shadowboxPerf?.().poseStatus === "ready",
  { timeout: 90_000 }
);
console.log("pose ready");

await page.evaluate(() => {
  const tick = () => requestAnimationFrame(tick);
  requestAnimationFrame(tick);
});

await page.getByRole("button", { name: /begin calibration/i }).click();
console.log("calibrating ...");

// Hold the window in front so pose frames keep arriving.
const until = Date.now() + 20000;
let calibrated = false;
while (Date.now() < until && !calibrated) {
  await page.bringToFront();
  await page.waitForTimeout(1500);
  calibrated = await page.evaluate(() =>
    document.body.innerText.includes("Calibrated")
  );
}

if (!calibrated) {
  console.log("CALIBRATION DID NOT COMPLETE — is a person fully in frame?");
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log(txt);
} else {
  console.log("calibration complete");
  await page.getByRole("button", { name: /free practice/i }).click();
  await page.bringToFront();
  await page.waitForTimeout(4000);
}

await page.screenshot({ path: OUT });
console.log(`saved ${OUT}`);
await browser.close();
