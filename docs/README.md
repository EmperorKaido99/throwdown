# Shadow Box docs

`CLAUDE.md` used to live in this folder. It now lives at the **repository root**
([../CLAUDE.md](../CLAUDE.md)) so that Claude Code loads it automatically at
session start — which is what that file assumes, and which does not happen from
a subdirectory.

Read in this order as the project progresses:

1. [01-ARCHITECTURE.md](01-ARCHITECTURE.md) — layered design, what's reused from the Flap project, what's new.
2. [02-IMPLEMENTATION-PLAN.md](02-IMPLEMENTATION-PLAN.md) — the risk-first milestone order.
3. [03-GESTURE-CLASSIFICATION.md](03-GESTURE-CLASSIFICATION.md) — required before touching the perception layer.
4. [04-NETWORKING-AND-NETCODE.md](04-NETWORKING-AND-NETCODE.md) — required before touching networking.
5. [05-TECH-SETUP-AND-RISK-LOG.md](05-TECH-SETUP-AND-RISK-LOG.md) — setup, pitfalls, and the living open-questions log. Update it in place as things are resolved.
