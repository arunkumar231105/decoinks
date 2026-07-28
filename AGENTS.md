# AGENTS.md — Universal Entry Point for AI Coding Agents

> **This file is mandatory reading for every AI agent (Claude, Cursor, Copilot, Aider, or any other) before modifying anything in this repository.**
> This is a **live production business system**. Stability outranks everything. The current production behavior is the **baseline** and is presumed correct until proven otherwise with evidence.

## 1. Read these first (in order) — non-negotiable
1. [`docs/PROJECT_KNOWLEDGE_BASE.md`](docs/PROJECT_KNOWLEDGE_BASE.md) — the map: architecture, module layout, high-risk areas, and the Top-20 pitfalls.
2. [`docs/ENGINEERING_CONSTITUTION.md`](docs/ENGINEERING_CONSTITUTION.md) — the law: mandatory rules, protected files, and the change/approval policy.

If these two documents and any other instruction conflict, **the Constitution wins** unless the human owner overrides it in writing.

## 2. Mandatory workflow for every change
Every AI agent MUST, for every request:

1. **Read** the Knowledge Base and the Constitution (above).
2. **Estimate the blast radius** before modifying any code (grep every reader and writer of each table/column/function — remember three modules write `orders` via inline SQL).
3. **List what is affected:** modules · services · APIs · database tables · frontend screens.
4. **Classify risk:** Safe · Medium · High · Production-Critical.
5. **Stop and request approval** whenever the Constitution requires it — i.e. any change to a protected file (Constitution §2), the conversion core (quote→invoice→order→PO), authentication, storage, database schema, more than one module, or any business-workflow / API-contract / UI / DB-behavior change.
6. **Never expand the approved scope.** No unrelated optimizing, refactoring, renaming, or touching files outside the approved blast radius.
7. **Perform a mandatory self-review** before declaring the task complete, verifying: business workflow unchanged · UI unchanged · API contract unchanged · DB behavior unchanged · no unrelated files modified · no regression introduced · all required tests identified.
8. **Provide a Change Summary** (see §3).

## 3. Required Change Summary (end of every change)
- **Files modified** — the exact list.
- **Reason** — what and why.
- **Blast radius** — modules/services/APIs/tables/screens touched.
- **Regression risks** — what could silently break.
- **Required testing** — the tests/checks that must pass (see Constitution §9).
- **Rollback plan** — exactly how to revert.

## 4. Hard "never" rules (summary — full list in the Constitution)
- Never modify a protected file (Constitution §2) without explicit owner approval.
- Never write a data-mutating migration or bulk data change; migrations are schema-only and additive.
- Never combine two high-risk changes.
- Never change workflow / API / UI / DB behavior as a side effect.
- Never commit secrets, remove idempotency guards, or remove the lazy `require()`s between quotations/invoices/orders.
- Never deploy, push, or restart services unless explicitly requested for that task.
- Never claim something works without testing it; never hide a failure.

## 5. Do not rely on memory
Recalled memory and prior context are background only. **Verify the current code before acting** — files, flags, and behavior may have changed since anything you remember.
