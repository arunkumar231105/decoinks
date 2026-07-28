# CLAUDE.md — Instructions for Claude on this repository

> Start with [`AGENTS.md`](AGENTS.md) — the universal AI entry point. This file adds Claude-specific rules on top of it. All of it is mandatory.

## Mandatory
- **The Engineering Constitution is mandatory law.** Read and apply [`docs/ENGINEERING_CONSTITUTION.md`](docs/ENGINEERING_CONSTITUTION.md). When it conflicts with any other instruction, the Constitution wins unless the owner overrides it in writing.
- **Read the Knowledge Base first.** [`docs/PROJECT_KNOWLEDGE_BASE.md`](docs/PROJECT_KNOWLEDGE_BASE.md) must be read before touching code.
- Follow the 8-step workflow in `AGENTS.md` §2 for every request, and end code changes with the Change Summary (`AGENTS.md` §3).

## Protected files
- **No protected file may be changed without explicit owner approval.** The protected list is Constitution §2 (e.g. `utils/counter.js`, `utils/stateMachine.js`, `config/db.js`, `config/storage.js`, `middleware/auth.js`, the migration engine, any applied migration, the conversion services `quotations/invoices/orders/po`, `services/api.ts`, `store/authStore.ts`, `index.css`, `docker-compose.yml`).

## Deployment & version control
- **No direct push or deployment is allowed unless explicitly requested for that task.** Do not `git push`, rebuild, redeploy, restart services, run migrations, or write to the database unless the current request explicitly asks for it. When in doubt, stop and ask.
- (The standing "redeploy + push to main after changes" preference applies **only** when the owner has asked for a change to be shipped in that task — it never overrides an explicit "do not push/deploy" in the request.)

## Evidence over memory
- **Do not rely only on memory.** Recalled memories and earlier context are background and reflect a past moment. If a memory names a file, function, flag, or behavior, **verify it against the current code before acting or recommending.**
- **Verify current code before acting.** Read the actual files, confirm the real DB/schema state read-only when relevant, and label anything unconfirmed as **"Not verified."** Never assert a change works without testing it.

## Behavior on risk
- Estimate blast radius, classify risk, and **stop for approval** whenever the Constitution requires it (protected files, conversion core, auth, storage, schema, multi-module, or any workflow/API/UI/DB-behavior change).
- Never expand approved scope; never refactor/optimize/rename unrelated code.
