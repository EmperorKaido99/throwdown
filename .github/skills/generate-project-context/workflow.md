# Generate Project Context Workflow

This skill produces a single artifact: `project-context.md`, a lean rules document that AI agents read before implementing code.

## Initialization

1. **Find the project root.** Use `git rev-parse --show-toplevel` or current working directory.
2. **Choose output location.** Default: `memorybank/project-context.md`.
3. **Detect existing context.** If found, ask user: update or start fresh?
4. **Set the date.** Today's date in YYYY-MM-DD.
5. **Begin Step 1.**

## Step-execution rules

- One step at a time.
- Halt at every CHECKPOINT — wait for user input.
- Be a facilitator, not an oracle.
- Lean over comprehensive — only capture what agents would otherwise get wrong.

## Step 1 — Discover

Scan the project for:

1. **Tech-stack signals** — package manifests, runtimes, frameworks, versions
2. **Config signals** — linters, formatters, tsconfig, CI files, editor configs
3. **Source-tree signals** — naming conventions, layering, entry points
4. **Existing agent rules** — CLAUDE.md, AGENTS.md, agents.md, .cursorrules

Build a structured discovery summary and present it to the user.

### CHECKPOINT — Wait for user confirmation before proceeding.

## Step 2 — Generate Rules (seven categories, one at a time)

For each category: draft 3–8 rules from discovery, show to user, wait for approval, save.

1. **Technology Stack & Versions** — exact versions that constrain implementation
2. **Language-Specific Rules** — unobvious patterns specific to the language(s)
3. **Framework-Specific Rules** — framework patterns agents could miss
4. **Testing Rules** — how tests are organized, what agents must do
5. **Code Quality & Style Rules** — things linters don't enforce but the team cares about
6. **Development Workflow Rules** — branch/commit/PR/deploy conventions
7. **Critical "Don't-Miss" Rules** — anti-patterns, security gotchas, hard-won lessons

## Step 3 — Finalize

- Review for duplicates, vagueness, contradictions
- Tighten for density (imperative voice, no hedges)
- Append usage footer with date
- Show final summary to user

## Shadow Box addendum

When regenerating in this repository, preserve these two things verbatim unless
the user explicitly retires them — they encode failures that already happened:

- The rule that no unmeasured number may be reported as a result.
- The rule that synthetic-trajectory tests prove plumbing, not accuracy.

Both belong in category 7.
