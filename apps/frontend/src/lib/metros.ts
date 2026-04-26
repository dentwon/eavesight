/**
 * Metros — scale-ready API client for metro-scoped reads.
 *
 * Every map, list, and detail view routes through these helpers so that when
 * we launch Nashville / Austin / Atlanta, the UI layer doesn't change — only
 * the selected metroCode does.
 */
import { api } from './api';

export interface Metro {
  code: string;
  name: string;
  stateCodes: string[];
  centerLat: number;
  centerLon: number;
  bboxMinLat: number;
  bboxMaxLat: number;
  bboxMinLon: number;
  bboxMaxLon: number;
  defaultZoom: number;
  tier: 'free' | 'pro' | 'enterprise';
  launchedAt: string | null;
}

export interface MetroDetail extends Metro {
  coverage: {
    propertyCount: number;
    pinCount: number;
    dormantCount: number;
    scoredCount: number;
  };
}

export interface HexAggregate {
  h3Cell: string;
  n: number;
  scoreP50: number | null;
  scoreP90: number | null;
  scoreMax: number | null;
  dormantCount: number;
  hailMaxInches: number | null;
  avgRoofAge: number | null;
  centerLat: number;
  centerLon: number;
}

export interface PinCardPayloadFree {
  id: string;
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  score: number | null;
  scoreBucket: 'hot' | 'warm' | 'cool' | 'cold';
  dormantFlag: boolean;
  roofAge: number | null;
  yearBuilt: number | null;
  yearBuiltConfidence: string | null;
  hailExposureIndex: number | null;
  scoreReasons: string[];
  tier: 'free';
}

export interface PinCardPayloadPro extends Omit<PinCardPayloadFree, 'tier'> {
  tier: 'pro';
  ownerFullName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  ownerOccupied: boolean | null;
  onDncList: boolean | null;
  phoneVerified: boolean | null;
  marketValue: number | null;
  assessedValue: number | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  roofAreaSqft: number | null;
  roofSizeClass: string | null;
  hailEventCount: number | null;
  claimWindowEndsAt: string | null;
  recentStorms: Array<{
    type: string;
    date: string;
    hailSizeInches: number | null;
    windSpeedMph: number | null;
    damageLevel: string | null;
    distanceMeters: number;
  }> | null;
}

export interface PinCardEntitlement {
  requestedTier: 'free' | 'pro';
  grantedTier: 'free' | 'pro';
}

export interface PinCardResponse<T = PinCardPayloadFree | PinCardPayloadPro> {
  propertyId: string;
  metroCode: string | null;
  score: number | null;
  dormantFlag: boolean;
  payload: T;
  updatedAt: string;
  /** Present when pro was requested; lets the UI render an upgrade nudge if downgraded. */
  entitlement?: PinCardEntitlement;
}

export interface ViewportFeature {
  id: string;
  lat: number;
  lon: number;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  score: number | null;
  dormantFlag: boolean;
  yearBuilt: number | null;
  scoreReasons: string[] | null;
  hailExposureIndex: number | null;

  /* --- SPC (Storm Prediction Center) rollups used by the view-switcher. --- */
  /** Count of hail reports within the cell over the last ~5 yrs. */
  spcHailCount5y: number | null;
  /** Max hail size (inches) observed in the cell over the SPC window. */
  spcHailMaxInches: number | null;
  /** ISO date of the most recent hail report in the cell. Drives Storm Age view. */
  spcHailLastDate: string | null;
  /** Count of tornado touchdowns near the property over the SPC window. */
  spcTornadoCount: number | null;
  /** Count of severe+ weather reports (any type) in the cell. */
  spcSevereOrExtremeCount: number | null;
}

export interface ViewportResponse {
  metroCode: string;
  bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number };
  count: number;
  limit: number;
  features: ViewportFeature[];
}

export const metrosApi = {
  list: () => api.get<Metro[]>('/metros').then(r => r.data),
  get: (code: string) => api.get<MetroDetail>(`/metros/${code}`).then(r => r.data),
  hexes: (code: string, res: 6 | 7 | 8 | 9 = 6) =>
    api.get<{ metroCode: string; resolution: number; features: HexAggregate[] }>(
      `/metros/${code}/hexes`, { params: { res } }
    ).then(r => r.data),
  top: (code: string, opts: { limit?: number; minScore?: number; dormantOnly?: boolean } = {}) =>
    api.get(`/metros/${code}/top`, { params: opts }).then(r => r.data),
  pinCard: <T = PinCardPayloadFree>(code: string, propertyId: string, tier: 'free' | 'pro' = 'free') =>
    api.get<PinCardResponse<T>>(
      `/metros/${code}/properties/${propertyId}/pin`, { params: { tier } }
    ).then(r => r.data),

  /**
   * Viewport query — used by the map at zoom >= 13 to fetch only the pins
   * currently visible. Replaces the old pre-computed 'top N' full-metro
   * fetch. Callers should debounce on map moveend/zoomend and pass an
   * AbortSignal so in-flight requests cancel when the viewport changes.
   */
  viewport: (
    code: string,
    bbox: { lonMin: number; latMin: number; lonMax: number; latMax: number },
    opts: { limit?: number; dormantOnly?: boolean; minScore?: number } = {},
    signal?: AbortSignal,
  ) =>
    api.get<ViewportResponse>(`/metros/${code}/viewport`, {
      params: {
        lonMin: bbox.lonMin,
        latMin: bbox.latMin,
        lonMax: bbox.lonMax,
        latMax: bbox.latMax,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.dormantOnly ? { dormantOnly: true } : {}),
        ...(opts.minScore !== undefined ? { minScore: opts.minScore } : {}),
      },
      signal,
    }).then(r => r.data),
};
