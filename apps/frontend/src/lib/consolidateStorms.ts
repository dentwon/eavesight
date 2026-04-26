/**
 * NOAA's storm feed often emits 2-4 near-duplicate reports for one cell —
 * each station files its own row with slightly different hail sizes. A single
 * property ends up joined to all of them, which renders as visual noise.
 *
 * This helper collapses raw property_storms rows into one per (localDate,
 * type) group. For HAIL rows, unique sizes are preserved in a sorted array so
 * the UI can show them as "1.5\", 1\", 0.75\"". Severity promotes to the
 * highest-ranked value seen in the group.
 */

export interface RawStormLink {
  stormEvent: {
    id: string;
    date: string;
    type: string;
    severity?: string | null;
    hailSizeInches?: number | null;
  };
}

export interface ConsolidatedStorm {
  key: string;
  date: string;         // original ISO from the first record in the group
  dateStr: string;      // pre-formatted for display (Apr 15, 2024)
  type: string;
  severity: string | null;
  hailSizes: number[];  // unique, sorted descending — empty for non-hail
}

const SEVERITY_RANK: Record<string, number> = {
  EXTREME: 4, SEVERE: 3, MODERATE: 2, LIGHT: 1,
};

export function consolidateStorms(rows: RawStormLink[]): ConsolidatedStorm[] {
  const groups = new Map<string, {
    key: string;
    date: string;
    dateStr: string;
    type: string;
    severity: string | null;
    hailSet: Set<number>;
  }>();

  for (const row of rows) {
    // Defensive: property_storms may carry an orphaned link where the
    // stormEvent row has been deleted (or Prisma chose not to hydrate it).
    // Skip silently rather than crash the whole sheet render.
    const se = row?.stormEvent;
    if (!se || !se.date) continue;
    const d = new Date(se.date);
    const localDateKey = isNaN(d.getTime())
      ? String(se.date).slice(0, 10)
      : d.toISOString().slice(0, 10);
    const groupKey = `${localDateKey}|${se.type}`;

    const existing = groups.get(groupKey);
    if (!existing) {
      const dateStr = isNaN(d.getTime())
        ? se.date
        : d.toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric',
          });
      groups.set(groupKey, {
        key: groupKey,
        date: se.date,
        dateStr,
        type: se.type,
        severity: se.severity ?? null,
        hailSet: new Set(
          typeof se.hailSizeInches === 'number' ? [se.hailSizeInches] : [],
        ),
      });
    } else {
      if (typeof se.hailSizeInches === 'number') existing.hailSet.add(se.hailSizeInches);
      const curRank = existing.severity ? (SEVERITY_RANK[existing.severity] ?? 0) : 0;
      const newRank = se.severity ? (SEVERITY_RANK[se.severity] ?? 0) : 0;
      if (newRank > curRank && se.severity) existing.severity = se.severity;
    }
  }

  return Array.from(groups.values())
    .map((g) => ({
      key: g.key,
      date: g.date,
      dateStr: g.dateStr,
      type: g.type,
      severity: g.severity,
      hailSizes: Array.from(g.hailSet).sort((a, b) => b - a),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
