/**
 * Single source of truth for estimating a property's roof age.
 *
 * Priority ladder (highest trust first):
 *   1) measured:  RoofData.age exists and is in a plausible window.
 *   2) permit:    Property.roofInstalledAt is a real install anchor --
 *                 currently populated from Huntsville CoC new-construction
 *                 records (source='coc-new-construction'), later from
 *                 trade-permit reroofs (source='permit-reroof') and
 *                 manual user input (source='manual').
 *   3) inferred:  fall back to yearBuilt with modular arithmetic, on the
 *                 assumption that aged roofs have been replaced one or more
 *                 times on the typical asphalt-shingle cycle.
 *   4) unknown:   we have nothing usable.
 *
 * Scoring code applies a graduated uncertainty discount keyed on source
 * (measured=1.0, permit=0.95 for coc / 0.85 for permit-reroof, inferred=0.70).
 * That discount lives in lead-scoring.service, not here, because it is a
 * scoring-policy concern rather than an estimation one.
 *
 * Frontend mirror: apps/frontend/src/lib/roofAgeEstimate.ts -- keep these
 * two in sync. (TODO: collapse to one shared package once we have a
 * packages/ dir.)
 */

export type RoofAgeSource =
  | 'measured'
  | 'coc'
  | 'permit'
  | 'inferred'
  | 'unknown';

export interface RoofAgeEstimate {
  age: number | null;
  source: RoofAgeSource;
  /** Raw source tag from the DB (e.g. 'coc-new-construction') when source
   *  is 'coc' or 'permit'. Useful for tooltips / audits. */
  sourceDetail?: string;
}

/** Never display or score a roof older than this. Pure physics: asphalt
 *  shingles (the dominant residential material in our market) are rated
 *  20-30 years; we pad with slack and still call anything beyond this a
 *  data error. */
export const ROOF_AGE_MAX_YEARS = 35;

/** Typical asphalt shingle replacement cycle (20-25 yrs nominal life).
 *  Phase 3.7a: NO LONGER USED in the canonical roof-age ladder (mod-22
 *  inference was dropped because it guessed rather than knew). Kept as
 *  an exported constant for downstream analytics that want to compare
 *  a measured age against the typical-life baseline.
 *  @deprecated do not use for new age-estimation paths. */
export const TYPICAL_ROOF_LIFE_YEARS = 22;

type PropertyInput = {
  yearBuilt?: number | null;
  roofInstalledAt?: Date | string | null;
  roofInstalledSource?: string | null;
  roofData?: { age?: number | null } | null;
};

function yearsSince(
  anchor: Date | string | null | undefined,
  referenceYear: number,
): number | null {
  if (!anchor) return null;
  const d = anchor instanceof Date ? anchor : new Date(anchor);
  if (Number.isNaN(d.getTime())) return null;
  const anchorYear = d.getUTCFullYear();
  if (anchorYear < 1900 || anchorYear > referenceYear) return null;
  return referenceYear - anchorYear;
}

function classifyRoofInstalledSource(
  raw: string | null | undefined,
): 'coc' | 'permit' {
  if (!raw) return 'permit';
  if (raw.startsWith('coc-')) return 'coc';
  return 'permit';
}

export function estimateRoofAge(
  property: PropertyInput | null | undefined,
  referenceYear: number = new Date().getFullYear(),
): RoofAgeEstimate {
  if (!property) return { age: null, source: 'unknown' };

  // 1) Directly measured roof age (e.g. from imagery or user-provided data).
  const measured = property.roofData?.age;
  if (
    typeof measured === 'number' &&
    measured >= 0 &&
    measured <= ROOF_AGE_MAX_YEARS
  ) {
    return { age: Math.round(measured), source: 'measured' };
  }

  // 2) Permit / CoC install anchor -- strong evidence, better than yearBuilt.
  //    If the anchor says the roof is older than ROOF_AGE_MAX_YEARS, treat
  //    it as unknown rather than falsely pinning it at the cap: a roof that
  //    old has almost certainly been replaced at least once since and the
  //    anchor no longer reflects the current roof.
  const anchorYears = yearsSince(property.roofInstalledAt, referenceYear);
  if (anchorYears !== null) {
    if (anchorYears > ROOF_AGE_MAX_YEARS) {
      return { age: null, source: 'unknown' };
    }
    const bucket = classifyRoofInstalledSource(property.roofInstalledSource);
    return {
      age: anchorYears,
      source: bucket,
      sourceDetail: property.roofInstalledSource || undefined,
    };
  }

  // 3) Phase 3.7a: mod-22 inference from yearBuilt is DEAD.
  //    Treating every old house as if it had been reroofed on a typical
  //    22-yr cycle was guessing, not knowing — a 136-year-old house was
  //    reporting a 4-year roof. We would rather have coverage gaps than
  //    false data. No anchor => unknown, period.
  //    Anchor coverage is backfilled by Phase 3.7b-e (assessor audit,
  //    NAIP aerial differencing, listing-text mining, solar cross-ref).

  return { age: null, source: 'unknown' };
}

/** Short inline suffix for UI display. Measured / CoC / permit get nothing
 *  (they are real data); inferred gets " (est.)"; unknown is handled by the
 *  caller (usually show "Unknown"). */
export function roofAgeSuffix(source: RoofAgeSource): string {
  return source === 'inferred' ? ' (est.)' : '';
}

/** Human-readable label for the age source. Safe to surface in UI tooltips
 *  and 'source of truth' rows in admin views. */
export function roofAgeSourceLabel(source: RoofAgeSource): string {
  switch (source) {
    case 'measured':
      return 'Measured roof age';
    case 'coc':
      return 'Certificate of Occupancy (new construction)';
    case 'permit':
      return 'Permit-anchored install date';
    case 'inferred':
      return 'Estimated from year built';
    case 'unknown':
      return 'No roof age data available';
  }
}

/** Scoring confidence multiplier. Keep this in sync with frontend mirror
 *  and with lead-scoring.service.ts (which is the only caller that should
 *  actually apply it). */
export function roofAgeConfidenceMultiplier(source: RoofAgeSource): number {
  switch (source) {
    case 'measured':
      return 1.0;
    case 'coc':
      return 0.95;
    case 'permit':
      return 0.85;
    case 'inferred':
      return 0.7;
    case 'unknown':
      return 0.0;
  }
}
