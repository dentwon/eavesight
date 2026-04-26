/**
 * Frontend mirror of apps/backend/src/leads/roof-age.util.ts.
 *
 * Kept as a duplicate (not imported from backend) because the frontend
 * needs to estimate roof age in places where the backend hasn't already
 * enriched the Property payload -- e.g. the map property sheet which is
 * fed directly from a Prisma-shaped response.
 *
 * Priority ladder (highest trust first):
 *   1) measured:  roofData.age in a plausible window
 *   2) coc:       roofInstalledAt with roofInstalledSource starting 'coc-'
 *   3) permit:    roofInstalledAt with any other source tag
 *   4) inferred:  mod-life heuristic over yearBuilt
 *   5) unknown
 *
 * Keep this file in sync with the backend mirror. If/when we unify the
 * API response shape so every caller gets roofAge+roofAgeSource
 * precomputed server-side, we can delete this file.
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
  sourceDetail?: string;
}

export const ROOF_AGE_MAX_YEARS = 35;
/** @deprecated Phase 3.7a: mod-22 inference is dead. Retained as a
 *  constant for analytics comparisons only. */
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

  const measured = property.roofData?.age;
  if (
    typeof measured === 'number' &&
    measured >= 0 &&
    measured <= ROOF_AGE_MAX_YEARS
  ) {
    return { age: Math.round(measured), source: 'measured' };
  }

  const anchorYears = yearsSince(property.roofInstalledAt, referenceYear);
  if (anchorYears !== null) {
    // Anchor claiming a roof older than the max-realistic age means the
    // roof has almost certainly been replaced since. Drop to unknown
    // rather than display the cap as if it were a known measurement.
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

  // Phase 3.7a: mod-22 inference from yearBuilt is DEAD.
  // No anchor => unknown, period. Kept in sync with backend mirror.

  return { age: null, source: 'unknown' };
}

/** Short inline suffix for UI. Measured / CoC / permit show nothing;
 *  inferred gets " (est.)"; unknown is handled by caller. */
export function roofAgeSuffix(source: RoofAgeSource): string {
  return source === 'inferred' ? ' (est.)' : '';
}

/** Tooltip / aria-label text for a given source. */
export function roofAgeSourceLabel(source: RoofAgeSource): string {
  switch (source) {
    case 'measured':
      return 'Measured roof age';
    case 'coc':
      return 'Certificate of Occupancy (new construction)';
    case 'permit':
      return 'Permit-anchored install date';
    case 'inferred':
      return 'Estimated from year built (typical replacement cycle)';
    case 'unknown':
      return 'No roof age data available';
  }
}
