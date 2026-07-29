import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * HTTPS for LAN testing, enabled with HTTPS=1.
 *
 * getUserMedia only runs in a secure context. localhost counts as one, so a
 * laptop never needs this — but a phone reaching the dev server at
 * http://192.168.x.x:5174 does not, and the camera is then unavailable with no
 * useful error. A self-signed certificate is enough: the phone shows a warning
 * once, and past it the origin is secure.
 *
 * Off by default because the certificate warning is pure friction for the
 * localhost case, which is most runs.
 */
const HTTPS = process.env.HTTPS === "1";

/**
 * Identifies the build that produced a measured run.
 *
 * On 2026-07-29 a recovered run from an older build was re-shared and read as a
 * fresh result. Establishing which code it came from took inspecting the shape
 * of the JSON for a field that had since been added. A report should say so
 * outright. Vercel exposes the commit; a local build falls back to the time.
 */
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  `local-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;

/**
 * Lets the pose Web Worker load MediaPipe's WASM runtime in dev.
 *
 * FilesetResolver dynamically imports the emscripten glue (vision_wasm_*.js)
 * at runtime. When that import originates inside a module worker, Vite's dev
 * server appends `?import` to the request — and for a static file under
 * public/ that query makes Vite try to resolve it as a module graph entry,
 * which fails with a 500 ("Failed to load url ..."). The main-thread path
 * doesn't hit this, so it only shows up once inference moves off-thread.
 *
 * Stripping the query for this one directory hands back the plain static file.
 * Dev-only: a production build serves these as ordinary static assets with no
 * query attached.
 */
function mediapipeWasmDevFix(): Plugin {
  const PREFIX = "/mediapipe/wasm/";
  return {
    name: "mediapipe-wasm-dev-fix",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith(PREFIX) && req.url.includes("?")) {
          req.url = req.url.split("?")[0];
        }
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react(), mediapipeWasmDevFix(), ...(HTTPS ? [basicSsl()] : [])],
  worker: {
    /**
     * Build the pose worker as a classic (IIFE) worker, not an ES module.
     *
     * MediaPipe's FilesetResolver loads its WASM glue with importScripts(),
     * which does not exist in module workers. Loading that glue as an ES
     * module instead fails with "ModuleFactory not set", because the glue
     * declares its factory as a top-level var — global in a classic script,
     * but module-scoped (and therefore invisible) in an ES module.
     */
    format: "iife",
  },
});
