/**
 * Resolve a displayable "property value" from the normalized fields.
 *
 * Alabama taxes residential (Class III) property at 10% of its appraised /
 * market value. Madison County parcel data ships BOTH:
 *   - totalAppraisedValue (the real dollar value) → stored as marketValue
 *   - totalAssessedValue  (10% of appraised, taxable)  → stored as assessedValue
 *
 * If marketValue is present, use it. Otherwise fall back to assessedValue × 10,
 * which is correct for Alabama Class III residential and a reasonable approx
 * elsewhere. Returns null when neither is known.
 */
export function getPropertyValue(p: {
  marketValue?: number | null;
  assessedValue?: number | null;
}): number | null {
  if (p.marketValue != null && p.marketValue > 0) return p.marketValue;
  if (p.assessedValue != null && p.assessedValue > 0) return p.assessedValue * 10;
  return null;
}
