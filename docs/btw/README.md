# Eavesight Reference — `docs/btw/`

Living documentation for the Eavesight roofing-intelligence platform.
Updated 2026-04-25 (post-rebrand from StormVault).

## What's in here

| File | What it covers | Who reads it |
|---|---|---|
| [01-data-inventory.md](./01-data-inventory.md) | Every table, every column, source of every field, current coverage % | Anyone touching the DB |
| [02-data-pipelines.md](./02-data-pipelines.md) | Ingestion jobs, scrapers, transformation queries, refresh cadence | Whoever owns ETL |
| [03-product-value.md](./03-product-value.md) | What the data lets us SELL, lead scoring rationale, dormant-lead thesis | PM / sales / pricing |
| [04-roadmap-backend.md](./04-roadmap-backend.md) | Backend work: multi-tenancy, RLS, query hardening, audit logging | Backend eng |
| [05-roadmap-frontend.md](./05-roadmap-frontend.md) | Frontend work: filter UI, perf, accessibility, mobile, design polish | Frontend eng |
| [06-security-pii.md](./06-security-pii.md) | PII inventory, leak vectors, RBAC matrix, compliance posture | Anyone touching auth or data exposure |

## Reading order

- **First time:** README → 01 → 03 → 06
- **Building features:** 01 → 02 → 04 (or 05)
- **Security review:** 06 → 04 → 01

## Living docs convention

- Update SESSION_STATE.md (root `docs/`) for daily operational state — not these.
- These docs change when **architecture or scope** changes, not when one number ticks up.
- When you change a table's schema, update `01-data-inventory.md`.
- When you add a data source, update `02-data-pipelines.md`.
- When you ship an auth change, update `06-security-pii.md` and revisit the RBAC matrix.

## Cross-references

- Operational state: `../SESSION_STATE.md` (top of root `docs/`)
- Field lookup: `../DATA_LOOKUP_INDEX.md`
- Memory snapshot: `~/.claude/projects/C--/memory/project_eavesight.md` (Windows side)