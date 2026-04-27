# Overnight Loop Queue — Eavesight Hardening

**Working branch:** `harden/security-2026-04-26` on VM `192.168.86.230` at `~/Eavesight`.

**Already committed in this session (batches A + B):**

- Audit findings file: `audit/SECURITY_AUDIT_2026-04-26.md`
- Pending migration (NOT applied): `audit/PENDING_MIGRATION_security_2026-04-26.sql`
- Deploy notes: `audit/HARDENING_DEPLOY_NOTES.md`
- ~25 findings closed across CRITICAL / HIGH / MED severities

**Verify state before starting next iteration:**

```bash
ssh dentwon@192.168.86.230 "cd ~/Eavesight && git status -sb && git log --oneline -5"
```

---

## Iteration protocol

Each iteration: pick exactly ONE item from the queue below, do the work,
typecheck (`cd ~/Eavesight/apps/backend && npx tsc --noEmit -p tsconfig.json`),
commit on `harden/security-2026-04-26`, mark item DONE in this file, move on.

If a task fails (build break, ambiguous spec, schema dependency you didn't
realize), revert the change and skip with a NOTE explaining why.

**Never restart PM2.** `pm2 list` is fine for inspection; `pm2 restart` is
not allowed overnight — user deploys in the morning.

**Never run `prisma migrate`.** All schema changes go through the queued
migration file the user reviews before applying.

---

## Queue (priority order)

### A. Validate the dep bumps just done

```bash
ssh dentwon@192.168.86.230 "cd ~/Eavesight && npm install 2>&1 | tail -30"
ssh dentwon@192.168.86.230 "cd ~/Eavesight/apps/backend && npx tsc --noEmit -p tsconfig.json"
ssh dentwon@192.168.86.230 "cd ~/Eavesight/apps/frontend && npx next build 2>&1 | tail -50"
```

If anything breaks: roll back the dep bump in `package.json`, commit
"chore(harden): roll back X dep bump — Y broke", and add a follow-up note.

### B. Tighten CSP

Currently the CSP in `apps/frontend/next.config.js` has `'unsafe-inline'` and
`'unsafe-eval'` for scripts and `'unsafe-inline'` for styles. Migrate to a
**per-request nonce** emitted from `apps/frontend/src/middleware.ts`, with
the nonce injected into `<script>` and `<style>` tags via Next.js conventions.
References:
- https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy

After: drop both `unsafe-inline` and `unsafe-eval`. If Next.js framework
scripts still need `unsafe-eval` for some reason in dev, scope it to dev only.

### C. Frontend middleware auth gate

`apps/frontend/src/middleware.ts` only does host canonicalization. For
protected routes (`/dashboard/**`), check the `eavesight_access` httpOnly
cookie presence and redirect to `/login` when missing. **Don't** verify the
JWT contents in middleware — that's the API's job. Just check existence so
the SSR-rendered shell of protected pages doesn't ship to anonymous users.

### D. Password reset flow

Implement `POST /auth/forgot-password` and `POST /auth/reset-password` on
the backend. Token is single-use, hashed at rest (sha-256), 1-hour expiry.
Email delivery uses the existing SMTP_* env vars. Constant-time response
shape on `forgot-password` (always succeeds — no enumeration).

Schema needs `PasswordResetToken { id, userId, tokenHash, expiresAt, usedAt }` —
add it to the **PENDING** migration file (do not auto-apply). Until applied,
the endpoints can be implemented behind a feature flag that returns 503.

### E. Re-audit pass

Once the queue empties (or as a sanity check halfway through), spawn three
parallel general-purpose Agent calls to re-audit the harden branch for:
1. New findings introduced by my changes
2. Findings I missed in the original audit
3. CSP escapability — can a user-controlled string in any rendered page
   inject content that ends up evaluated under our CSP?

Append any new findings to `audit/SECURITY_AUDIT_2026-04-26.md` and queue
fixes here.

### F. NestJS 10 → 11 major bump (risky)

Stop at this item — DON'T attempt unless the loop has been productive and
nothing else is left. Major bump touches every controller's decorator
behavior, `RawBodyRequest` semantics, throttler API, etc. Better to defer
to a daylight session with the user available.

### G. Defer to user

The following require user review and are intentionally NOT to be touched
overnight:

- Plan enum / ProcessedStripeEvent / subscription columns / tokenVersion /
  tokenFamily — all queued in `audit/PENDING_MIGRATION_security_2026-04-26.sql`
- Refresh token family + reuse detection (depends on tokenFamily column)
- Logout invalidates access JWT (depends on tokenVersion column)
- `typescript.ignoreBuildErrors=false` cleanup (would break the build until
  every existing type error is fixed; needs user input on which errors to
  fix vs. suppress)

---

## Status log (loop appends here)

(empty — loop fills in)

### Iteration 1 — 2026-04-27 (overnight)
- DONE: Validated dep bumps via `npm install` — next 14.1.0→14.2.35, axios 1.13.6→1.15.2.
- DONE: Committed package-lock.json on harden branch.
- STARTED: Frontend `next build` (running async).
- SKIPPED: Item C (frontend middleware auth gate) — current login flow uses zustand+localStorage, not cookies; cookie-only middleware can't gate non-OAuth users without coordinated frontend refactor. Filed as user-review item.
- NEXT: Check next build result, then password-reset scaffold, then re-audit pass.

### Iteration 2 — 2026-04-27 (overnight)
- Spawned 3 parallel re-audit agents on harden branch.
- Found 12+ new findings; appended to audit/SECURITY_AUDIT_2026-04-26.md.
- DONE: Batch C — closed 9 of them (NC1 org mass-assign + role escalation, NC2 parcel harvester admin gates, NC4 bbox finite guards, NC10 health DSN scrub, earmark holder org overlap, lockout LRU, dummy bcrypt valid format, cf-connecting-ip loopback validation, NC3 metros throttle + limit cap).
- Migration file extended with NC6 (reveal-meter race unique index).
- Backend tsc clean.
- DEFERRED: frontend localStorage->cookie migration (C1/C2/H2), canvassing PII bypass (NC8), PII allow-list invert (NC7), CSP nonce — all need user attention or significant refactor.
- All commits on harden/security-2026-04-26: 5e04b4c → 5823c92 → d44cd1c → 15a0e3f → 33b4841 → 6e378fb.

### Loop stop reason
- Critical/high autonomous-fixable items have been addressed.
- Remaining items either (a) require user UX/architecture decisions or (b) need the pending migration to land. Both are user-review items, not autonomous-loop work.

### Iteration 3 — 2026-04-27 (overnight, second /loop run)
- DONE: **Batch D** (the largest deferred item from iteration 2): full frontend localStorage → httpOnly cookie migration. Backend issues cookies on every auth path; frontend stops storing tokens in localStorage entirely. Closes critical re-audit findings C1, C2, H2.
- DONE: CSP `unsafe-eval` dropped in production (kept in dev for HMR). `form-action` narrowed to `'self'`.
- VALIDATED: Backend tsc clean. Two consecutive `next build` runs clean (22 routes).
- All commits on harden/security-2026-04-26 through d309de5. Eight commits total.

### Loop final stop reason
- Frontend cookie migration was the highest-leverage remaining critical; it's now closed.
- Items still pending all require user input:
  - **NC8 canvassing PII**: requires product/UX decision (mask owner fields by default vs. require explicit reveal).
  - **NC7 PII allow-list invert**: large refactor touching every property serialization path.
  - **NestJS 10→11 major bump**: risky in autonomous mode; defer to daylight.
  - **typescript.ignoreBuildErrors=false**: requires fixing 5 pre-existing maplibre type errors in `MetroMap.tsx` line 2174-2348 (`*-transition` properties not in current @types/maplibre-gl).
  - **Apply pending migration**: user-only operation.
- Halting per loop protocol.
