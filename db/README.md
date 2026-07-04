# ⚠️ Deprecated — do not edit or apply these files

These SQL files were the old Docker init scripts. They are **no longer
mounted** into the Postgres container (see `docker-compose.yml`) and are
kept only as historical reference for databases that were originally
created from them.

The database schema is owned entirely by **`backend/migrations/`**:

- On every backend container start, `docker-entrypoint.sh` runs
  `ensure-baseline.js` + `run.js`, which apply any pending migrations.
- `backend/migrations/039_baseline_repair.sql` heals every known gap
  between databases created from these init scripts and databases built
  purely from migrations.

To change the schema, add a new numbered migration in
`backend/migrations/` — never edit these files.
