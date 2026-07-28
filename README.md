# Decoinks Printshop OS

A full-stack Print Shop POS/ERP for a custom apparel / DTF / gangsheet printing business, covering the pipeline **Customer → Quotation → Invoice → Sales Order → Purchase Order → Shipment**, plus an external Supplier Portal.

## AI Contributors

This is a **live production business system** — stability comes first, and the current production behavior is the baseline. **Before making any code change**, every AI agent and developer must read, in order:

1. [`AGENTS.md`](AGENTS.md) — universal AI entry point and the mandatory change workflow.
2. [`docs/ENGINEERING_CONSTITUTION.md`](docs/ENGINEERING_CONSTITUTION.md) — the mandatory rules, protected files, and approval policy (the law).
3. [`docs/PROJECT_KNOWLEDGE_BASE.md`](docs/PROJECT_KNOWLEDGE_BASE.md) — architecture, high-risk areas, and pitfalls (the map).

Claude-specific instructions: [`CLAUDE.md`](CLAUDE.md). Cursor rule: [`.cursor/rules/project-governance.mdc`](.cursor/rules/project-governance.mdc).

Do not change protected files, database schema, migrations, or runtime configuration, and do not deploy or push, without explicit owner approval as defined in the Constitution.
