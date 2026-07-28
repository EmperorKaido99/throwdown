// Diagnostic: probes the real app page's <video> element to find where frames
// are being lost between the camera and detectForVideo.

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
  ],
});
const context = await browser.newContext({ permissions: ["camera"] });
const page = await context.newPage();
page.on("console", (m) => console.log(`  [browser] ${m.text()}`));
page.on("pageerror", (e) => console.log(`  [pageerror] ${e.message}`));

await page.goto(BASE + "/?screen=train", { waitUntil: "domcontentloaded" });
await page.bringToFront();
await page.getByRole("button", { name: /enable camera/i }).click();
await page.waitForFunction(
  () => window.__shadowboxPerf?.().poseStatus === "ready",
  { timeout: 90_000 }
);
await page.waitForTimeout(4000);

const probe = await page.evaluate(async () => {
  const vids = Array.from(document.querySelectorAll("video"));
  const v = vids[0];
  if (!v) return { error: "no <video> in the app page" };

  const gaps = [];
  const times = [];
  let last = 0;
  const onFrame = (now) => {
    if (last) gaps.push(now - last);
    last = now;
    times.push(v.currentTime);
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);
  await new Promise((r) => setTimeout(r, 5000));

  const med = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  // How many of those callbacks carried a genuinely new currentTime?
  let distinct = 0;
  for (let i = 1; i < times.length; i++) if (times[i] !== times[i - 1]) distinct++;

  return {
    videoCount: vids.length,
    readyState: v.readyState,
    paused: v.paused,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    rvfcFires: gaps.length,
    medianGapMs: med(gaps),
    distinctCurrentTimes: distinct,
  };
});

console.log("\n--- app <video> probe (5s window) ---");
console.log(JSON.stringify(probe, null, 2));
if (probe.medianGapMs) {
  console.log(`\nrVFC on the app's video: ${(1000 / probe.medianGapMs).toFixed(1)} FPS`);
  console.log(
    `frames with a NEW currentTime: ${probe.distinctCurrentTimes}/${probe.rvfcFires}`
  );
}

await browser.close();
