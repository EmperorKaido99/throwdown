// Captures the hardware/browser identity behind a measurement run, so numbers
// recorded in 05-TECH-SETUP-AND-RISK-LOG.md are attributable to a machine
// rather than floating free.

import { chromium } from "playwright-core";

const BASE = process.env.BASE_URL ?? "http://localhost:5174";

const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage();
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });

const info = await page.evaluate(() => {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  let renderer = "unavailable";
  let vendor = "unavailable";
  if (gl) {
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    if (dbg) {
      renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
    }
    renderer = `${renderer} | ${gl.getParameter(gl.VERSION)}`;
  }
  return {
    gpuVendor: vendor,
    gpuRenderer: renderer,
    webgl2: !!c.getContext("webgl2"),
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: navigator.deviceMemory ?? "unreported",
    platform: navigator.platform,
    userAgent: navigator.userAgent,
  };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();
