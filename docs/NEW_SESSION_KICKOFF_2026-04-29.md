# New Claude Desktop Session — Roadmap Kickoff

You're picking up the **ML / inference / training-data lane** for Eavesight roof intelligence v1. A previous Desktop session trained a Prithvi-EO-2.0-300M model overnight and locked a master roadmap. You're continuing from there.

## Step 1 — Read these in this order. Don't skip.

```bash
# THE CONTRACT — single source of truth
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/ROADMAP_2026-04-29.md"

# The peer-review response that locks decision thresholds
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/PRITHVI_TRACK_RESPONSE_2026-04-29.md"

# Code's overnight summary (their lane, what they shipped)
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/OVERNIGHT_2026-04-29.md"

# Code's noon contract (their v1 deliverables)
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/CODE_HANDOFF_NOON_2026-04-29.md"

# AL insurance-window (Code already formalized v1#12)
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/AL_INSURANCE_CLAIM_WINDOW.md"

# Cloud tech stack (informs where v1 outputs eventually live; OUT of v1 scope)
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/TECH_STACK_PLAN.md"

# Skiptrace pipeline (mock provider lets v1 demo without vendor signup; OUT of v1 scope)
ssh dentwon@192.168.86.230 "cat /home/dentwon/Eavesight/docs/SKIPTRACE_PIPELINE.md"
```

After reading, you know:
- The 17 v1 deliverables locked through Friday 2026-05-03
- The 8-dimensional lead score
- The 12 locked decisions (Prithvi-300M Apache, Travis primary training, 8 dims, etc.)
- The 8 anti-scope-creep boundaries — DON'T VIOLATE
- Friday gate criteria: Decatur cross-val `recall_2yr ≥ 0.70 AND mae_years ≤ 2.5`
- Tech stack: VM through 50 roofers, then Hetzner; R2 for cold storage
- Skiptrace: Phase 0 Mock provider is parallel Code work, NOT a v1 dep

If anything looks wrong, raise it with Odell. Don't relitigate locked decisions.

## Step 2 — Lane

**Yours (Desktop ML/inference):**
- F:\eavesight-roof-intel\ on Windows (training, inference, model artifacts)
- training.* schema on VM (read-only OK)
- Travis training pipeline, JSONL exports, model card, reproducibility
- v1 deliverables: #1 (multi-pair inference), #6 (domain-shift exp), #11 (`score_imagery_unchanged`), #14 (industry-baseline Agent task), #15 (demo dataset, joint with Code), #17 (model card)

**Not yours:**
- apps/backend/, apps/frontend/, scripts/permits-*, scripts/compute-scores-* — Code's lane
- public.* schema, signal-emit, blend SQL, scoring — Code's lane
- Tech-stack production migration — separate parallel session
- Mock skiptrace provider — separate parallel session
- AL insurance-window SQL — Code already wrote it

## Step 3 — Current state

✅ **Done:**
- Prithvi-EO-2.0-300M trained on Travis (val_AUC 0.8832, ckpt at `F:\eavesight-roof-intel\runs\v1\best.pt`)
- 6,267 paired clips on F:\, 12,175 .tif files (5,175 pos + 7,000 neg)
- Local venv: `F:\eavesight-roof-intel\.venv` (Python 3.12, PyTorch 2.5.1+cu121, terratorch, timm, rasterio)
- Roadmap committed at `harden/security-2026-04-26` branch (latest: `cd964c5`)
- bypassPermissions set in `~/.claude/settings.json` — you should NOT hit approval prompts. If you do, flag it.

⏳ **In flight (running on VM, not your problem):**
- 8 PIA-tunnel MLS scrapers
- HMDA loan ingestion
- compute-scores-v3 + build-pin-cards-v4
- Code's parallel work on segments #7-#13

❌ **Not started — your queue:**
- CSV export of N-AL targets to `/tmp/n_al_targets.csv` (a previous attempt was canceled by user; redo)
- Domain-shift quick experiment (~2 hr, decides multi-pair vs single-pair)
- Multi-pair refactor of `infer_north_alabama.py` (currently single-pair 2019 vs 2023; needs 3 pairs spanning 2011-2023)
- Pilot 1000-property inference run
- Full 243K inference run (~30-45 hr if multi-pair, ~10-15 hr if single-pair)
- JSONL export + scp to VM
- Industry-baseline Agent task (Agent tool, subagent_type=general-purpose, 3-4 hr background)
- Model card + reproducibility doc

## Step 4 — Execution order (priority, with rough timing)

### Hour 0 (right now)

1. **Spawn the industry-baseline Agent task** — uses the `Agent` tool with `subagent_type=general-purpose`. Background, 3-4 hr, no dependency on anything else. Output: `docs/industry-baselines-2026.md` covering NRCA annual replacement rate, IBHS roof-life studies, AHS time-to-replacement, Verisk post-hail claim rates, state-by-state insurance SOL summary table.
2. **Re-export N-AL CSV** from VM Postgres. The previous attempt was canceled. Run with statement_timeout=600000 (10 min) since LATERAL JOIN over 243K × 301K is slow:
   ```bash
   ssh dentwon@192.168.86.230 "PGOPTIONS='-c statement_timeout=600000' psql 'postgresql://eavesight:eavesight@localhost:5433/eavesight' -c \"\\COPY (SELECT p.id::text, p.lat::float, p.lon::float, ST_AsText(b.geom) AS bldg_wkt FROM properties p JOIN LATERAL (SELECT ub.geom FROM unified_buildings ub WHERE ST_DWithin(ub.geom::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography, 30) ORDER BY ub.geom <-> ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326) LIMIT 1) b ON true WHERE p.lat IS NOT NULL AND p.lon IS NOT NULL) TO '/tmp/n_al_targets.csv' WITH CSV HEADER\""
   ```
   Then scp to F:\eavesight-roof-intel\data\n_al_targets.csv.

### Hour 1-2

3. **Domain-shift quick experiment** (~2 hr). Train a tiny binary discriminator on 500 Travis tiles vs 500 N-AL tiles. Computes how much distribution shift exists. **Decides whether multi-pair is worth the 30-45h compute.**
   - AUC > 0.85: strong shift, single-pair good enough; flag JSONL with `expected_calibration_drop=high`
   - 0.65-0.85: moderate shift, multi-pair wins (more time-windows hedge per-window calibration errors)
   - < 0.65: minimal shift, multi-pair net-positive but not critical
   - Save to `runs/v1/domain_shift_audit.json`

### Hour 3-5

4. **Refactor `F:\eavesight-roof-intel\infer_north_alabama.py` to multi-pair.** Add config for [(2011,2015), (2015,2019), (2019,2023)]. Combine: `P(any_replacement) = 1 - prod(1 - P_pair_i)`, `P(unchanged) = 1 - P(any_replacement)`. Add 3 derived scores: `dormant_post_storm_score`, `aged_unreplaced_score`, `still_original_likelihood` (formulas in PRITHVI_TRACK_RESPONSE Q3).
5. **Write the model card** (~½ day). HuggingFace markdown format. Include training data hash, config, val AUC, known limitations.

### Hour 5+

6. **Pilot 1000-property inference run** (~30-45 min). Validate JSONL shape, no crashes, sane probability distributions, GPU OOM doesn't trigger.
7. **If pilot clean: launch full 243K inference in background.** ~30-45 hr if multi-pair. Schedule wakeup for ~hour 25-30.

### When inference completes (~Wed evening / Thu morning)

8. **scp JSONL to VM** at `/home/dentwon/Eavesight/data/inference/n_al_v1_<timestamp>.jsonl`.
9. **Notify Code** with a short doc at `docs/PRITHVI_INFERENCE_DROP_2026-XX-XX.md`. They'll run `node scripts/load-prithvi-signals.js --commit --jsonl=... --auc=<reported> --validate-against=decatur`.
10. **Wait for Code's Decatur cross-val output.** That's the Friday-gate decision.

### Friday 2026-05-03 — gate

11. Joint with Code: GREEN/YELLOW/RED decision per locked thresholds (PRITHVI_TRACK_RESPONSE §Q2).
12. If GREEN/YELLOW: assemble demo dataset (deliverable #15). If RED: trigger v1.5 N-AL fine-tune (roadmap §4).

## Step 5 — Things you should NOT do

- ❌ Retrain Prithvi (model is FROZEN per §12 boundary 1)
- ❌ Add Wake/Hamilton training data (deferred to v2 per §6)
- ❌ Single-image aged-roof classifier (v2)
- ❌ Touch backend/frontend (Code's lane)
- ❌ Extend Friday to "by Monday" (§12 boundary 8)
- ❌ Propose 9th lead-score dimension (§12 boundary 3)
- ❌ Implement insurance-window logic in Python (Code's `AL_INSURANCE_CLAIM_WINDOW.md` has SQL)
- ❌ Relitigate Prithvi vs Clay (locked, AGPL kills moat)
- ❌ Get sidetracked by tech-stack migration discussion (§16 explicit: doesn't extend v1)
- ❌ Try to set up real Trestle skiptrace (§17 explicit: Phase 0 mock is parallel Code work)

## Step 6 — Coordination

- **Memory files:** Update `~/.claude/projects/C--/memory/project_roof_intel_progress.md` with state changes. The full memory index is `~/.claude/projects/C--/memory/MEMORY.md`.
- **Roadmap amendments:** if you legitimately need to change v1 scope, append to `docs/ROADMAP_2026-04-29.md` §18 with date + signature + rationale, then commit.
- **Status to Odell:** terse, action-oriented. Don't summarize what they already know. DO report numbers, errors, decision points. **Don't waste their time with apologies — just ship and report.**
- **Don't go dark for >12 hours** without a `ScheduleWakeup` armed.

## Step 7 — Open questions (non-blocking, pick up if relevant)

1. Travis test-set held-out 15% AUC — should be in `runs/v1/history.json`. Cite in model card.
2. Calibration plot from Travis val set (reliability diagram). 1 hour.
3. NAIP 2003-2009 availability for AL — domain-shift experiment will exercise this.
4. Whether the v2 blend correctly composes the 8 dimensions or produces them separately (Code's task).

## Step 8 — Final note

Friday is Friday. The roadmap §12 boundaries are not suggestions. If you find yourself doing something that's not in v1 §3, ask "is this required for the Friday gate?" If no, file as v1.5 in §4.

The previous Desktop session ended mid-day Wednesday after committing the roadmap, the §16/§17 amendments, and three handoff docs. Branch tip: `cd964c5`. Both parallel-session plans (cloud tech stack, skiptrace pipeline) have landed on VM under their respective filenames and are referenced in roadmap §16/§17.

The Travis model is solid (val_AUC 0.8832). The pipeline is wired (Code's signal-emit loader auto-validates against Decatur). The discipline mechanism is the roadmap. **Just ship the inference and report the cross-val numbers.**

— Previous Desktop session, signing off
