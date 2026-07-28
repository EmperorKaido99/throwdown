// Diagnostic: measures raw camera frame delivery with NO MediaPipe work, to
// separate "the webcam/compositor is slow" from "inference is slow".
//
// Opens a blank page, grabs getUserMedia directly, and counts
// requestVideoFrameCallback fires over a fixed window.

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const SECONDS = Number(process.argv[2] ?? 8);

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
// Needs a secure context for getUserMedia; localhost qualifies.
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.bringToFront();

const result = await page.evaluate(async (seconds) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  const v = document.createElement("video");
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  document.body.appendChild(v);
  await v.play();

  const track = stream.getVideoTracks()[0];
  const settings = track.getSettings();

  const rvfcGaps = [];
  const rafGaps = [];
  let lastR = 0;
  let lastA = 0;

  const done = new Promise((resolve) => setTimeout(resolve, seconds * 1000));

  const onFrame = (now) => {
    if (lastR) rvfcGaps.push(now - lastR);
    lastR = now;
    v.requestVideoFrameCallback(onFrame);
  };
  v.requestVideoFrameCallback(onFrame);

  const onRaf = (now) => {
    if (lastA) rafGaps.push(now - lastA);
    lastA = now;
    requestAnimationFrame(onRaf);
  };
  requestAnimationFrame(onRaf);

  await done;
  stream.getTracks().forEach((t) => t.stop());

  const med = (a) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };

  return {
    granted: settings,
    rvfcCount: rvfcGaps.length,
    rvfcMedianGap: med(rvfcGaps),
    rafCount: rafGaps.length,
    rafMedianGap: med(rafGaps),
    visibility: document.visibilityState,
    focused: document.hasFocus(),
  };
}, SECONDS);

const hz = (ms) => (ms > 0 ? (1000 / ms).toFixed(1) : "0");

console.log(`\n--- raw camera / compositor diagnostic (${SECONDS}s) ---`);
console.log(`camera granted : ${JSON.stringify(result.granted)}`);
console.log(`visibility     : ${result.visibility}  focused: ${result.focused}`);
console.log(
  `video frames   : ${result.rvfcCount}  median gap ${result.rvfcMedianGap.toFixed(
    1
  )}ms  => ${hz(result.rvfcMedianGap)} FPS`
);
console.log(
  `rAF ticks      : ${result.rafCount}  median gap ${result.rafMedianGap.toFixed(
    1
  )}ms  => ${hz(result.rafMedianGap)} FPS`
);
console.log(
  "\nIf video frames are ~30 FPS here but the pose run was ~1 FPS, inference\n" +
    "is the bottleneck. If BOTH are ~1 FPS, the camera or compositor is."
);

await browser.close();
