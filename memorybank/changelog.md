# Changelog — Ad-hoc Changes

Changes made outside the scope of any task file. Includes quick fixes, opportunistic improvements, or config tweaks noticed during other work.

| Date | Description | Files Changed | Related Task (if any) |
|------|-------------|---------------|-----------------------|
| 2026-07-28 | Agent harness (D5 workflow + memorybank) installed from the public setup prompt. Project name "Shadow Box", ticket prefix `SB`, context in `memorybank/`. | `agents.md`, `.github/copilot-instructions.md`, `.github/skills/`, `memorybank/**`, `README.md` | SB-005 |
| 2026-07-28 | UI shell added around the existing debug harness — main menu, screen routing, mobile-responsive layout, persisted settings. Existing `PunchHarness` reachable unchanged from the Train screen. | `src/App.tsx`, `src/ui/shell/**`, `src/config/settings.ts` | SB-004 |
| 2026-07-28 | Risk log entries 15 (animation-as-trigger + mocap projection) and 16 (player height/reach) recorded. | `docs/05-TECH-SETUP-AND-RISK-LOG.md` | — |
| 2026-07-28 | Phone-run enablement: spoken prompts, screen wake lock, touch abort, stage aspect ratio from the real stream, HTTPS-over-LAN dev scripts. All five are things that would have voided or corrupted a measured run on a phone. | `src/ui/speech.ts`, `src/ui/useWakeLock.ts`, `src/ui/PunchHarness.tsx`, `src/App.tsx`, `src/App.css`, `src/config/settings.ts`, `vite.config.ts`, `package.json` | SB-013 |
