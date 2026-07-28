# Shadow Box - GitHub Copilot Instructions

## Prerequisites — Always Load Project Context

Before **any** planning, discovery, or implementation work, read `memorybank/project-context.md` in full. That file contains the authoritative rules for tech stack, coding conventions, testing, and critical anti-patterns. Follow those rules exactly — they take precedence over generic best practices.

---

## Precedence — how this file relates to `CLAUDE.md`

This repository has two instruction layers. They do not compete:

| Layer | Governs | Authority |
|---|---|---|
| `CLAUDE.md` + `docs/01`–`05` | **What** may be built and in what order — non-negotiable technical decisions, risk-first milestone order, the rule against reporting unmeasured numbers | Highest. A D5 task may not be used to route around it. |
| This file (D5 workflow) | **How** a unit of work proceeds — define, discover, plan, approve, implement, verify, document | Governs task execution within the bounds above. |
| `agents.md` | Coding behaviour — simplicity, surgical diffs, stated assumptions | Applies throughout. |

Concretely: if a `SB-XXXX` ticket asks for networking before Milestone 1 has a
measured confusion matrix, the correct D5 output is a Define-phase objection,
not an implementation plan.

---

## D5 Agentic Workflow

> ⚠️ **CRITICAL — FOLLOW THE WORKFLOW EXACTLY. NO SHORTCUTS. NO SKIPPING STEPS.**
> The D5 workflow exists for a reason. Every phase, every checkpoint, every stop point is intentional. You MUST:
> - Complete each phase **fully and in order** before moving to the next.
> - **Never skip** creating the task file or adding the ticket to `memorybank/ticket-progress.md`.
> - **Never make code changes** before receiving explicit human approval in the Deliver phase.
> - **Never proceed past a 🛑 STOP checkpoint** without explicit human confirmation.
> - If in doubt, **stop and ask** — do not assume approval or take initiative to "save time."
>
> Violating any of these rules breaks trust and invalidates the workflow.

All development tasks **must** follow the D5 workflow. No code changes should be made without completing each phase in order.

### StartTask Command

When the user says **"StartTask SB-XXXX"** (or similar), initiate the D5 workflow:

> 💡 **Model Hint:** Use a **thinking/reasoning model** for the **Define** and **Discover** phases — these require deep reasoning and thorough investigation. Once the implementation plan is **approved**, a **faster implementation model** is fine for the **Deliver** grunt work.

1. Ask the user to provide the ticket details or describe the task.
2. Walk through the **Define** phase by asking:
   - **Goal**: What is the expected outcome?
   - **Constraints**: Are there technical, time, or scope constraints?
   - **Definition of Done**: What conditions must be met to consider this complete?
3. Create a task tracking file at `memorybank/activeTasks/SB-XXXX.md` using the template below.
4. Add an entry to `memorybank/ticket-progress.md` with status `🔍 Discovery`.
5. Proceed through the remaining D5 phases.

### ReviewTasks Command

When the user says **"ReviewTasks"** (or similar), review all in-progress tasks:

1. Read `memorybank/ticket-progress.md` and identify all tasks that are **not** `✅ Done`.
2. For each incomplete task, read its task file at `memorybank/activeTasks/SB-XXXX.md`.
3. Present a **summary table** showing: Ticket ID, Title, Current status/phase, What's blocking or next.
4. Ask the user which task(s) to **resume**, **update**, or **close**.
5. If resuming, pick up the D5 workflow from the phase where it was left off.

### The D5 Phases

#### 1. Define — Goal, Constraints, and Definition of Done

- Capture the ticket details (SB-XXXX).
- Ask clarifying questions to establish:
  - **Goal**: What problem are we solving?
  - **Constraints**: Performance, compatibility, scope limitations.
  - **Definition of Done**: Specific acceptance criteria.
- Record all of this in the task tracking file.
- Update `memorybank/ticket-progress.md` status to `🔍 Discovery`.

#### 2. Discover

- **First:** Read `memorybank/project-context.md` if not already loaded this session.
- **Read component docs:** Check `memorybank/components/` for any existing documentation on the feature being changed. If a component doc exists, read it to understand current business rules, data flow, and validation before investigating the code.
- Investigate the codebase **thoroughly** to understand the root cause or area of change.
- **Scan all layers** — do not skip files. Examine all relevant source directories, configurations, tests, and shared modules.
- Read relevant files, search for symbols, trace the full flow end-to-end.
- **Search externally** for improvements, best practices, and package updates:
  - Check official documentation for updated guidance.
  - Check package registries for newer versions.
  - **Always prefer official docs** over third-party blog posts.
  - Note any relevant deprecations, new APIs, or recommended patterns.

**📝 Progressive Updates — Write findings to the task file as you go:**
- **Update `SB-XXXX.md` incrementally** after each discovery step — do NOT wait until the end.
- After scanning each layer, immediately append findings to the Discover section.
- The task file serves as a **resumable checkpoint** — the user can stop and continue later.
- By the end of Discover, the task file should contain a **complete picture**: all affected files, root cause analysis, external research, and a draft of the implementation plan.
- Update `memorybank/ticket-progress.md` status to `📋 Awaiting Approval`.
- **Do NOT edit any code in this phase.**

#### 3. Deliver — The Smallest Possible Change

> ⚠️ **HARD RULE — NO EXCEPTIONS**: The Deliver phase is split into **PLAN** and **IMPLEMENT**. You MUST complete PLAN and receive explicit human approval BEFORE writing any code. Under NO circumstances should you modify any source file until the user explicitly approves.

**Step 1 — PLAN (no code changes allowed):**
- Plan the minimal set of changes required.
- Document planned changes in the task file under **Implementation Plan**.
- **🛑 STOP — Human Approval Required.**
  - Present the plan to the user.
  - **Do NOT proceed until the user explicitly approves.**

**Step 2 — IMPLEMENT (only after explicit approval):**
- Update `memorybank/ticket-progress.md` status to `🚧 In Progress`.
- **Follow the implement-verify loop:**
  1. **Act:** Make the next planned change (smallest coherent unit).
  2. **Verify:** Run the build and relevant tests after each change.
  3. **Keep or fix:** If tests pass, move on. If tests fail, fix before continuing.
  4. **Stop when:** Plan is complete and green, OR progress stalls twice on the same item (escalate), OR scope change needed (request approval).
- **Never** change existing patterns or architecture without explicit approval.
- **Never** over-engineer. Prefer the simplest solution.
- **Never** fold unrelated fixes into the patch — log those in `memorybank/changelog.md`.
- If tests do not exist for the affected area, write them.

#### 4. Demonstrate — Prove the Fix with Test Output

- Update `memorybank/ticket-progress.md` status to `🧪 Testing`.
- Run existing tests to confirm nothing is broken.
- Run new/updated tests to confirm the fix works.
- Record test output in the task file under **Test Results**.
- Build must pass.
- **🛑 STOP — Human Verification Required.**
  - Present test results to the user.
  - Ask the user to manually test and confirm.
  - **Do NOT proceed until the user explicitly confirms.**
  - **Feedback repair loop:** If issues reported:
    1. Diagnose the issue.
    2. Apply smallest fix.
    3. Re-run build + tests.
    4. Present updated results. Repeat until confirmed.

> **Shadow Box addition:** for any task whose Definition of Done contains a
> number (frame rate, detection rate, accuracy, latency), unit tests are not
> sufficient evidence. The Demonstrate phase is complete only when the measured
> number is recorded in `docs/05-TECH-SETUP-AND-RISK-LOG.md`. Passing synthetic
> tests prove the plumbing works, not that the number was met.

#### 5. Document — Prepare the Change for Review

- Update `memorybank/ticket-progress.md` status to `📝 Documenting`.
- Update the task file with a summary of all changes made.
- **Documentation sync loop** — for each memorybank doc file, check if the task's changes affected its domain. Update if yes, record "N/A" if no:
  - [ ] `memorybank/features.md` — new features, changed behavior
  - [ ] `memorybank/architecture.md` — new entities, services, modules, schema
  - [ ] `memorybank/integrations.md` — new external APIs, auth changes
  - [ ] `memorybank/setup.md` — new env vars, config changes
  - [ ] `memorybank/components/*.md` — update any affected component docs (business rules, data flow, validation, key files). If the task changes a feature that has no component doc yet, **create one** using the template in `memorybank/components/_index.md`. If an existing component doc's business rules, data flow, validation, or key files changed, **update it** to reflect the new reality.
  - [ ] `docs/05-TECH-SETUP-AND-RISK-LOG.md` — any assumption confirmed, refuted, or newly discovered
- **Alignment check** — after updating docs, verify consistency across the three knowledge layers:
  1. `memorybank/project-context.md` — tech stack rules, coding conventions, anti-patterns
  2. `memorybank/features.md` — feature list and high-level behavior
  3. `memorybank/components/*.md` — detailed per-feature flows, business rules, validation

  If any of these contradict each other after the task's changes, reconcile them now.
- If the task introduced architectural changes, run `generate-project-context` skill in update mode.
- Move task file from `memorybank/activeTasks/` to `memorybank/completedTasks/`.
- Update `memorybank/ticket-progress.md` status to `✅ Done`.
- Log any ad-hoc or out-of-scope changes in `memorybank/changelog.md`.

---

## Task Tracking File Template

When creating `memorybank/activeTasks/SB-XXXX.md`, use this structure:

```
# SB-XXXX: [Title]

## Define
- **Goal**:
- **Constraints**:
- **Definition of Done**:

## Discover
_(Updated progressively — each section filled in as discovery proceeds)_

### Findings

### Affected Files
| File | Role | Notes |
|------|------|-------|

### Root Cause / Area of Change

### External Research
- Relevant docs/updates:
- Package updates available:

### Discovery Summary

## Deliver
### Implementation Plan
- [ ] Change 1
- [ ] Change 2

### Approval
- **Status**: ⏳ Awaiting approval / ✅ Approved / ❌ Rejected
- **Approved by**:
- **Notes**:

### Changes Made
- File: `path/to/file` — Description of change

## Demonstrate
### Test Results
- Build: ✅ / ❌
- Tests: ✅ / ❌
- Output:

### Human Verification
- **Status**: ⏳ Awaiting / ✅ Confirmed / 🔄 Iteration needed
- **Feedback**:

## Document
- **Summary**:
- **Documentation Updated**:
```

---

## Tracking Files

### `memorybank/ticket-progress.md`
Tracks the **status of all tickets** across sessions. Allows planning one day and resuming the next.

### `memorybank/changelog.md`
Log of **ad-hoc changes** outside any task file — quick fixes, opportunistic improvements, config tweaks.
