# Centralized suite database

The live system uses `decoinks_postgres` / `decoinks_db` as the single
PostgreSQL instance for all four applications.

| Application | Schema |
| --- | --- |
| Decoinks | `public` |
| Technocas CRM normalized data | `app` |
| Technocas CRM auxiliary data | `technocas` |
| BlankTex | `blanktex` |
| DTF Mockup Creator | `dtf` |
| Cross-application views/events | `integration` |

Legacy Technocas clients may continue using host port `5436`; the
`central-database-compose.yml` compatibility service forwards it to the
central instance. New services should use the shared Docker network and the
central `DATABASE_URL`.

## Data safety

Pre-migration, cutover, authoritative Technocas, and post-cutover logical
backups are stored under `/root/central-db-backups`. Each backup set includes
SHA-256 verification. The old `technocas_postgres`, `blanktex-db-1`, and
`dtfmockupcreater-db-1` containers/volumes are stopped but retained as
read-only rollback sources; do not start them while the centralized services
are accepting writes.

The integration migrations are additive. They create unified customer,
order, and product views plus a sanitized `integration.data_events` outbox.
Password and token fields are excluded from captured event payloads.
