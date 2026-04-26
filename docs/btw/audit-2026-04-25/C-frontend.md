---

# Eavesight Frontend Audit — Demo-Readiness Report

## 1. TL;DR

- **Most demo-impressive working feature:** the `MetroMap` (`components/metro/MetroMap.tsx`, 2733 lines) — real MapLibre + PMTiles building footprints, H3 r6/r8 hex heatmap, viewport-driven pin streaming, score-bucket filters, click-to-property, real-time storm SSE alert overlay. This is the centerpiece and it actually works.
- **Worst demo-breaker:** **the dashboard has TWO maps and two property pages with diverging UX**. `dashboard/properties/page.tsx`, `dashboard/leads/page.tsx`, `dashboard/canvassing/page.tsx`, and `dashboard/settings/page.tsx` are still **white/light mode hardcoded** (`bg-white`, `bg-gray-50`, `text-gray-900`) — they ignore the dark theme that the rest of the app uses. Toggling theme leaves these pages blinding-white. Looks broken.
- **Most stubbed-but-pretends-real:** **Analytics** (`dashboard/analytics/page.tsx`). The "Conversion Funnel" multiplies `totalLeads * 0.6 / 0.35 / 0.2` to fabricate Contacted/Qualified/Quoted counts (lines 70-74). Revenue uses a hardcoded `avgJobValue = 12500` (line 86). "Cost Per Lead = $0" hardcoded (line 170). A roofer who knows their numbers will spot this in 5 seconds.
- **Biggest cosmetic embarrassment:** the landing page (`app/page.tsx`) hero contains a fully hardcoded fake property card "1423 Oakwood Dr / J. Williams / Mar 2026 hail" (lines 188-202), fabricated stats "47 New Leads / 203 Properties / 12 Priority" (lines 224-243), and `<a href="/demo">` and `/about` `/contact` `/forgot-password` `/terms` `/privacy` links that don't resolve to any route (no files exist for them). Footer also says "**2026 Eavesight**" (no copyright symbol — line 897).

---

## 2. Page Matrix (every dashboard route)

| Route | Status | API calls | What renders | Demo concern |
|---|---|---|---|---|
| `/` (landing) | works | none | Marketing page w/ animated fake map + pricing | Hero is 100% hardcoded; `/demo` `/about` `/contact` `/terms` `/privacy` `/forgot-password` are dead links |
| `/login` | works | `POST /auth/login` | Login form | Placeholder shows `test@eavesight.io` |
| `/signup` | works | `POST /auth/register` | Register w/ org creation | OK — creates org inline |
| `/dashboard` (Home) | works | `GET /leads`, `/storms`, `/analytics/overview` | Greeting, stat cards, hot leads, callable list, recent storms | Empty for new orgs — friendly EmptyState though |
| `/dashboard/map` | works | `GET /properties/:id` + MetroMap viewport calls | MetroMap + side-panel + create-lead handoff to QuickCapture | **No date scrubber for storms; no "drop pin → properties in radius" tool**; click is property-only. Large file (329 lines) |
| `/dashboard/pipeline` | works | `GET /leads`, `PATCH /leads/:id` | Kanban (desktop) / stage tabs (mobile) w/ drill-in sheet | **No drag-and-drop** — only "Move to next stage" buttons. Functional, but reviewer may expect DnD |
| `/dashboard/leads` | works | `GET /leads`, `POST /leads`, `PATCH /leads/:id/status` | Table + create modal + slide-over | **HARDCODED LIGHT (`bg-slate-900` mixed w/ `bg-slate-800` — does NOT honor theme tokens)**, hardcoded `city: 'Huntsville', state: 'AL'` in form |
| `/dashboard/prospects` | works | `GET /madison/search`, `POST /madison/leads` | Madison-County-only parcel search | **Hardcoded to Madison County** (`/madison/search`). Score is computed client-side from heuristics (lines 104-143). Roof age is "guess" from value ratio |
| `/dashboard/properties` | partial | `GET /properties` | Card grid + slide-over | "Add Property" button is **inert** (no onClick — line 74). "Create Lead for This Property" + "Add to Target List" buttons in detail panel **do nothing** (lines 259-264). Light mode hardcoded |
| `/dashboard/canvassing` | works | `GET /storms`, `GET /leads/canvassing` | Storm-picker → ranked door list w/ print | Light-mode hardcoded; relies on backend `/leads/canvassing` route returning enriched joined data |
| `/dashboard/alerts` | works | `GET /alerts/active`, SSE `/alerts/stream`, earmark POST/DELETE | Live worklist + filters + earmark | "Live feed connected" pill goes amber if SSE drops — visible flag if backend SSE not running |
| `/dashboard/analytics` | **partial / fake** | `GET /analytics/overview`, `GET /analytics/leads-by-month` | KPIs, funnel, monthly bars, revenue snapshot | **Funnel & revenue are fabricated** from 60%/35%/20% multipliers + $12,500 avg job. "Cost Per Lead $0" hardcoded |
| `/dashboard/team` | works | 5× `GET /analytics/team/*` + `/forecast/revenue` | Leaderboard, velocity, decay, equity, forecast | Empty until backend has rep activity. `EmptyState` is friendly |
| `/dashboard/settings` | partial | `GET /auth/me`, `PATCH /users/:id`, `PATCH /orgs/:id`, `POST /auth/logout` | 5 tabs | Notification toggles are **local state only — never POST**. Billing tab is **all hardcoded** ($Free/$49/$149 plans, "Coming Soon" buttons) and **disagrees with the marketing pricing** ($99/$249) |
| `/m/[metro]` | works | `useMetro` hook + MetroMap | Metro-scoped variant w/ DormantLeadsList, AutoPitchCard | Distinct sidebar; same map component |

---

## 3. Mobile Matrix

| Component | Status | Notes |
|---|---|---|
| `MobileFieldHome` (rendered on `/dashboard` mobile) | works | Greeting, live storm CTA, big "Open the map" tile, hot list. Real `GET /leads` |
| `MapPropertySheet` | works | Score pills, value/year/storm grid, Navigate (Google Maps URL), Call (`tel:`), Lead handoff. Solid |
| `QuickCaptureSheet` (FAB) | works | Geolocation → `GET /properties/nearest` → `POST /leads`. Vibration on save |
| `MobileMoreSheet` | works | Overflow menu w/ navigation + theme toggle + logout |
| `LiveAlertBanner` | works | `md:hidden` for the desktop banner; mobile uses badge in header |
| Mobile pipeline (`MobilePipeline` inside pipeline/page.tsx) | works | Stage tabs + bottom-sheet detail |
| Mobile leads table | partial | Card layout exists but **uses dark slate explicitly** — won't honor light theme |
| Mobile properties | broken-feel | Same desktop card grid; "Add Property" / "Create Lead" buttons inert |
| Mobile canvassing | works | Sticky header + collapsible cards. Light mode only |

---

## 4. Stubbed / Dummy / Hardcoded Inventory

| File:Line | Hardcoded |
|---|---|
| `app/page.tsx:194-199` | Fake property "1423 Oakwood Dr · J. Williams · Mar 2026 hail · $285,000" |
| `app/page.tsx:181` | "Huntsville, AL area" + "5 Active Storms" |
| `app/page.tsx:228, 233, 238` | "47 New Leads / 203 Properties / 12 Priority" stats |
| `app/page.tsx:481-495` | "243K+ properties / 2M+ storms / 34K+ surveys / 3 counties" — may or may not match DB |
| `app/page.tsx:897` | Footer "2026 Eavesight" missing © symbol |
| `app/login/page.tsx:66` | Placeholder `test@eavesight.io` |
| `app/(dashboard)/dashboard/analytics/page.tsx:71-74` | Funnel uses `totalLeads * 0.6 / 0.35 / 0.2` fabrication |
| `app/(dashboard)/dashboard/analytics/page.tsx:86-88` | `avgJobValue = 12500`, derived `pipelineValue` |
| `app/(dashboard)/dashboard/analytics/page.tsx:170, 174` | "Cost Per Lead $0" + "$50-200/lead" copy |
| `app/(dashboard)/dashboard/settings/page.tsx:340-343` | Billing plans hardcoded `Starter Free / Pro $49 / Team $149` (CONTRADICTS landing page $99/$249) |
| `app/(dashboard)/dashboard/settings/page.tsx:333` | "ALPHA" badge + "free tier during alpha testing" copy |
| `app/(dashboard)/dashboard/settings/page.tsx:368` | Plan upgrade buttons say "Coming Soon" |
| `app/(dashboard)/dashboard/settings/page.tsx:55-57, 304-313` | Notification toggles never persist — no API call on change |
| `app/(dashboard)/dashboard/settings/page.tsx:318` | "SMS notifications coming soon" |
| `app/(dashboard)/dashboard/leads/page.tsx:318-319` | Form defaults `city: 'Huntsville', state: 'AL'` |
| `app/(dashboard)/dashboard/properties/page.tsx:72` | "in Huntsville area" hardcoded |
| `app/(dashboard)/dashboard/properties/page.tsx:74-79, 152-157, 259-264` | "Add Property", "Create Lead", "Add to Target List", "View Details" buttons all no-op |
| `app/(dashboard)/dashboard/page.tsx:518` | Quick action "Search Madison County properties" hardcoded |
| `app/(dashboard)/dashboard/prospects/page.tsx:525, 541` | API path `/madison/search`, `/madison/leads` Madison-only |
| `app/(dashboard)/dashboard/prospects/page.tsx:104-143` | Lead score is **client-side heuristic**, not backend. "Roof age est" from value ratio |
| `app/(dashboard)/dashboard/prospects/page.tsx:620` | Try-search chips: `'SEARCY DR', 'MAPLE DR', 'OAK ST', 'GOLF COURSE'` |
| `app/(dashboard)/dashboard/page.tsx:409` | Storm row falls back to `'Madison County'` if county null |
| `app/(dashboard)/dashboard/map/page.tsx:67` | Hard-coded center `[-86.5854, 34.7304]` (Huntsville) |
| `components/metro/MetroMap.tsx:132` | `pmtiles:///buildings-v4.pmtiles` — relies on `/public/buildings-v4.pmtiles` existing on disk |

---

## 5. Demo Walkthrough Simulation (roofer in front of you)

1. **Land on `/`** — hero looks great, 5 animated storm pins + property card. Roofer asks: *"Is that a real address?"* → **Awkward**. Then sees `Pricing $249 / $99` → mentally locks that in.
2. **Click "Get Started" → /signup** — fills form. ✅ Org gets created server-side via `organizationName`. Lands on `/dashboard`.
3. **`/dashboard` greeted with "Good morning, X"** — but **all stat cards are zero** (new org). Hot Leads shows EmptyState. **Demo dies here unless you pre-seeded data into the demo org.**
4. **Click "Map" tile** — MetroMap loads (Huntsville centered). PMTiles buildings appear at z12+. **This is the wow moment** — assuming `/public/buildings-v4.pmtiles` is deployed and viewport endpoint returns scored properties. Roofer clicks a building → side panel populates real owner/year/storm data.
5. **Roofer asks: "Can I scrub the date to see what storms hit last March?"** → **No date scrubber exists.** Hex heatmap only shows aggregate score.
6. **Roofer asks: "Drop a pin and show me everything in 1km"** → No such tool. Workaround: search prospects.
7. **Click "Create Lead" from map sheet** → QuickCaptureSheet opens, geolocation runs, POSTs `/leads`. Works. ✅
8. **Visit `/dashboard/leads`** → light slate-800 panel appears in dark UI, **but if user toggled to Light Mode it stays slate** — visibly inconsistent w/ the rest. Lead created from map IS visible (no name, but address from notes). ✅
9. **Visit `/dashboard/pipeline`** → Kanban renders. Roofer drags card → **nothing** (no DnD). Has to click → "Move to Contacted →" button. Functional but feels old.
10. **Visit `/dashboard/canvassing`** → light mode. Picks a storm → ranked list works (✅). Print button works.
11. **Visit `/dashboard/analytics`** → roofer sees Funnel: 100 leads → 60 Contacted → 35 Qualified → 20 Quoted. **He knows damn well his contact rate isn't exactly 60%.** Reveals fabrication.
12. **Visit `/dashboard/settings/Billing`** → sees plans **$0 / $49 / $149** — **conflicts with landing page $99/$249**. Awkward.
13. **Toggle Dark/Light** → map smoothly remounts (curtain wash works), but `/dashboard/leads`, `/dashboard/properties`, `/dashboard/canvassing`, `/dashboard/settings`, `/dashboard/prospects` (parts) **don't change** — they have hardcoded slate or white.

---

## 6. Punch List (top 10, ranked by demo-impact × ease)

### Functional (must-fix before demo)

1. **Replace fabricated funnel with real data.** `dashboard/analytics/page.tsx:70-88`. Either compute funnel from `leads.filter(s => s.status === 'CONTACTED')` etc. or hide the funnel card until the org has ≥10 leads. (high impact, easy)
2. **Reconcile pricing.** Landing says $99/$249; Settings billing says $49/$149. Pick one. `app/page.tsx:570,633` vs `dashboard/settings/page.tsx:340-343`. (medium impact, trivial)
3. **Wire properties page buttons or hide them.** "Add Property", "Create Lead for This Property", "Add to Target List", "View Details" are inert. `dashboard/properties/page.tsx:74,152-157,259-264`. (high impact, easy: route them to `/dashboard/leads` create modal w/ prefilled property) 
4. **Persist notification toggles.** `dashboard/settings/page.tsx:55-57` — currently pure local state. Either POST or remove the section. (medium impact, easy)
5. **Pre-seed demo org with leads, storms, won jobs.** Without this, every page is an EmptyState. (highest impact — handled outside frontend)
6. **Add an Add-Lead route from desktop sidebar / Home.** Currently desktop "Find Prospects" goes to Madison search only. A roofer demo wants a 3-click path to an entered address → lead. (medium impact, easy)

### Cosmetic

7. **Theme-token sweep on `dashboard/leads`, `dashboard/properties`, `dashboard/canvassing`, `dashboard/settings`, `prospects` create-lead modal.** Replace `bg-slate-*`, `bg-white`, `text-gray-*` with `bg-card`, `text-foreground`, `text-muted-foreground`. (high cosmetic impact, medium effort — bulk find/replace across ~5 files)
8. **Remove fake property card from landing hero** or replace with a stylized illustration that doesn't claim a real address/owner. `app/page.tsx:188-202`. Same for the "47 / 203 / 12" stats. (medium impact, easy)
9. **Stub the `/demo`, `/about`, `/contact`, `/terms`, `/privacy`, `/forgot-password` routes** — even a simple "Coming soon" page. Currently they 404. `app/page.tsx:52,878-892`, `login/page.tsx:90`. (low-medium impact, easy)
10. **Footer copyright fix:** `2026 Eavesight` → `© 2026 Eavesight`. `app/page.tsx:897`. (trivial)

---

### Other notable findings

- **Backend dependency surface for the demo:** the map/dashboard rely on these endpoints actually working: `/properties/:id`, `/properties/nearest`, `/leads` (GET/POST/PATCH), `/storms`, `/analytics/overview`, `/analytics/leads-by-month`, `/analytics/team/*`, `/alerts/active`, `/alerts/stream` (SSE), `/alerts/properties/:id/earmark`, `/leads/canvassing`, `/madison/search`, `/madison/leads`, plus the metros API (`metrosApi.viewport`, `metrosApi.hexes`). If any of these 404 the page **silently empties** (most catches use `/* noop */`), so failures become invisible empty states.
- **Auth flow is solid** — refresh-token retry interceptor (`lib/api.ts:38-100`), persisted Zustand store with hydration gate (`stores/auth.ts:81-99`), redirect guard in dashboard layout (`app/(dashboard)/layout.tsx:82-88`). Won't bounce on refresh.
- **MetroMap is the crown jewel** — sophisticated PMTiles+H3 setup, viewport debouncing w/ AbortController, theme remount strategy preserving camera, score-bucket filters, hex/building dual rendering. Treat it gently in the demo (zoom slowly past z=12 to show buildings appear).
- **No date scrubber, no radius-pick tool, no DnD pipeline** — all features a roofer would expect from "TitanCRM/HailTrace-replacement" positioning. None are quick wins; flag as roadmap.
- **EarmarkButton** is wired to real API and does optimistic UI w/ rollback — good demo material.
- **The retired map components** (`components/map/.MapView.tsx.retired` etc.) are still on disk — clean up before any demo recording shows the file tree.
