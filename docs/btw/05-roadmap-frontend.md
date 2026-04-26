# Frontend Roadmap — UI/UX Engineering Work

Frontend is `apps/frontend/` — Next.js 14 App Router + MapLibre GL + PMTiles.
Same priority scheme as backend doc: P0 (must ship), P1, P2.

## P0 — Must ship before user pilot

### 1. Tier-aware UI rendering

**Status**: All authenticated users currently see the same property sheet (`MapPropertySheet.tsx`) which can render owner contact info if backend returns it.

**Plan**:
1. Read `user.tier` from Zustand store
2. Free tier: hide owner section, show upgrade CTA where it would have been
3. Pro tier: show full owner info + history
4. Enterprise: add bulk-export buttons + score breakdown panel

Pair with backend P0 #2.

### 2. Skip-trace usage meter

When a Pro user clicks "Reveal contact info" → modal with:
- "This will use 1 of your 47 remaining skip-trace credits this month"
- Confirm button → triggers backend skip-trace endpoint
- After: shows phone/email + "Logged at 14:32 to your audit trail"

### 3. Login/auth UX rebuild

**Current state**: bare-bones login page, no password reset, no email verification flow, no 2FA.

**Plan**:
1. Password reset (token email + new password page)
2. Email verification on registration (NestJS already issues `emailVerified` field, frontend doesn't enforce)
3. 2FA — TOTP via authenticator app (Pro tier+)
4. Session list page ("active sessions" with revoke button)

### 4. Org / team management UI

For Pro tier+:
- `/settings/team` — invite users to org, change roles
- Role enum: OWNER / ADMIN / ANALYST / VIEWER
- Permissions matrix shown (who can skip-trace, who can export, who can manage billing)
- Audit log viewer

---

## P1 — Correctness / UX gaps

### 5. Filter panel rebuild

**Current state**: Limited filters (storm date range only).

**Plan** (matches backend P1 #7):
- Slider: minimum hail size (0.75" / 1.0" / 1.25" / 1.5" / 2.0")
- Slider: hail event count in last 5 years
- Year-built range
- Score threshold + bucket multi-select
- Trigger checkboxes (probate, recent transfer, investor flip, dormant)
- Material filter (asphalt / metal / tile)
- "Save this filter" → presets per user
- URL query-string sync (shareable links)

### 6. Score reasons panel

When pin is opened, show:
- Total score (84) with progress ring
- Component bars (urgency 32 / revenue 18 / trigger 25 / occupancy 9)
- Bullet list with icons:
  - 🌩️ 7 SPC hail events on record (max 1")
  - ⏰ Hail within claim window (2025-05-20)
  - 🏚️ Roof likely ≥ 29 years old (built 1997)
  - 👥 Probate / estate trigger in owner record
  - 💰 Investor rotation: 3 distinct owners in 5y
- "What would change this score?" expandable section

### 7. Mobile-responsive everything

**Current state**: Map works on mobile but pin sheet is desktop-only proportions.

**Plan**: Full mobile responsive pass — bottom-sheet pattern for pin card, hamburger filter panel, sticky tier-CTA.

### 8. PWA install + offline-friendly map

Service worker + manifest. Cache the 5-county PMTiles for field use.

### 9. Performance: cluster→dot fade

Already implemented but needs perf testing at 250K+ pins. Goal: 60fps zoom, <16ms frame on M-class hardware.

### 10. Storm overlay improvements

- Tornado path polygons (after backend SVRGIS ingest)
- Date-range picker with presets (24h, 7d, 30d, 90d, 1y, 5y, all)
- Storm intensity legend (toggleable)
- Click storm → show all properties affected

### 11. Lead workflow (Pro+)

- Save property to lead list
- Lead-list status (new / contacted / appointment / quoted / closed / lost)
- Per-lead notes
- Per-lead reminder (calendar)

### 12. Notifications

- In-app notification bell (BullMQ → WebSocket → Toast)
- Email digest preferences (storm overhead, new permits in saved area, hot leads added)
- Push notification (PWA, post-mobile)

---

## P1.5 — Branding/polish (rebrand follow-through)

### 13. Replace any leftover StormVault references in UI copy
Already 99% done via sed but spot-check:
- Login page footer
- Email templates (welcome, password reset, etc.)
- Help / about pages
- 404 / 500 error pages

### 14. New visual identity
Eavesight ≠ StormVault. Logo, color palette, typography. User is UI/UX designer — let them lead. Frontend just needs to consume the design tokens.

### 15. Marketing surface (`/`, `/pricing`, `/about`)
Currently the root is the dashboard. Need a public marketing site.

---

## P2 — Future / aspirational

### 16. AI assistant (Pro+)
"Show me all houses in Madison with 1.5"+ hail in the last 18 months that haven't filed a claim and the owner is over 65" — natural-language → filter+query.

### 17. Heatmap toggles
- Hail-size weighted
- Score-weighted
- Trigger-weighted
- Custom (combine signals)

### 18. Walking-route optimizer (Pro+)
Pick a list of leads → compute optimal door-knock order accounting for crew start address.

### 19. Photo upload from field (Pro+)
Photograph a roof while on a job → attach to property → date-stamped → roof-condition log.

### 20. CRM integrations
JobNimbus, AccuLynx, RoofLink. Push leads, pull job-history.

---

## Component-level audit

| Component | Status | Notes |
|---|---|---|
| `MetroMap.tsx` | Solid | MapLibre + PMTiles + H3 hex tiers — keep |
| `MapPropertySheet.tsx` | Need P0 #1 tier-gating + P1 #6 reasons panel |
| Filter panel | Need full rebuild (P1 #5) |
| Login | Bare-bones, needs P0 #3 |
| Settings | Doesn't exist yet |
| Lead workflow | Doesn't exist yet (P1 #11) |
| Notifications | Doesn't exist yet (P1 #12) |
| Marketing site | Doesn't exist yet (P1.5 #15) |

---

## Accessibility (WCAG)

- Color-blind-safe heatmap palette (currently fails for deuteranopia)
- Keyboard nav on the map (currently mouse-only)
- Screen-reader labels on pin pop-ups
- Focus management in modals
- Contrast ratios on dark theme text (some currently below 4.5:1)

Run axe-core on every page in CI. Fail builds on new violations.

---

## Sequencing recommendation

**Week 1**: P0 #1 (tier UI) + #3 (auth UX skeleton)
**Week 2**: P0 #2 (skip-trace) + #4 (org/team) + P1.5 #13-14 (branding)
**Week 3-4**: P1 #5 (filters) + #6 (score reasons)
**Week 5-6**: P1 #7 (mobile) + #11 (lead workflow)
**Week 7+**: P2 backlog