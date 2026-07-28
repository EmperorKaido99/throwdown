# Component Documentation

This folder contains detailed documentation for each feature/component in the system. Each file documents one logical component — its business rules, data flow, UI interactions, validation, and integration points.

## Purpose

When an agent needs to modify a feature, it reads the relevant component doc to understand:
- **What** the feature does (business rules, user-facing behavior)
- **How** data flows through the system
- **Where** the code lives (files, modules, layers involved)
- **Why** certain decisions were made (constraints, edge cases, gotchas)

## File Naming

Use kebab-case matching the feature name:
- `punch-detection.md` — Deciding that a punch happened at all
- `punch-classification.md` — Deciding which punch it was
- `dodge-detection.md` — Continuous head lean/duck state
- `calibration.md` — Per-player guard, jitter, torso scale, stance
- `measurement-protocol.md` — The guided run that produces the confusion matrix

## Template

Each component doc should follow this structure:

---

# [Component/Feature Name]

## Overview
_(1–2 sentences: what this feature does from the user's perspective)_

## Business Rules
- Rule 1: ...
- Rule 2: ...

## Data Flow

```
[Trigger] → [Module] → [Module] → [Output]
```

### Step-by-step:
1. ...

## Validation Rules

| Input | Rule | Where Enforced | Failure behaviour |
|-------|------|----------------|-------------------|

## Key Files

| File | Role |
|------|------|

## Measured vs Reasoned

| Constant | Value | Source |
|---|---|---|

_(Shadow Box-specific and mandatory: every threshold a component depends on must
be marked as measured from real data or reasoned from geometry. Silently
promoting a reasoned number to a measured one is the failure mode this project
guards against hardest.)_

## Edge Cases & Gotchas
- ...

## Related Components
- ...

---
