// Single source of truth for Eavesight subscription tiers.
// Mirrored to apps/frontend/src/lib/plans.ts — change BOTH together.
//
// `entitlements` is the machine-readable enforcement surface (used by
// guards / middleware to gate features server-side). `features` is the
// human-facing marketing copy used by the landing page + Settings → Billing.

export type PlanCode = 'SCOUT' | 'BUSINESS' | 'PRO' | 'ENTERPRISE';

export interface FeatureBullet {
  label: string;
  status: 'live' | 'soon';
}

export interface PlanEntitlements {
  maxSeats: number;
  countyAccess: 'one-fixed' | 'one-user-chosen' | 'all-active' | 'all-metros';
  ownerContactReveal: boolean;       // false = name-only (Scout)
  dncScrub: boolean;
  leadPipeline: 'view-only' | 'solo' | 'multi-user';
  mobileFieldCapture: boolean;
  stormHistoryYears: number;          // 1, 5, 10, 99 (full archive)
  alertGranularity: 'county' | 'zip' | 'property' | 'custom-rules';
  leadScoring: 'none' | 'buckets' | 'unified-100' | 'custom-rules';
  canvassingRoutes: 'none' | 'one-per-day' | 'unlimited';
  bulkPreReveal: boolean;             // pre-pull a hail zone in one click
  teamAnalytics: boolean;             // leaderboard, per-rep dashboards
  funnelAnalytics: boolean;
  permitOverlay: boolean;
  territoryLocking: boolean;
  brandedReports: boolean;
  apiAccess: boolean;
  webhooks: boolean;
  crmSync: boolean;
  auditLog: boolean;
  dedicatedCsm: boolean;
  supportTier: 'docs' | 'email' | 'email-chat' | 'priority';
}

export interface PlanDef {
  code: PlanCode;
  name: string;
  tagline: string;
  priceMonthly: number;
  revealQuota: number;
  roofMeasurementQuota: number;
  overageRevealCents: number | null;
  overageRoofCents: number | null;
  fairUseRevealCeiling: number | null;     // soft cap that triggers a Custom contract conversation
  highlight?: boolean;
  features: FeatureBullet[];
  entitlements: PlanEntitlements;
  stripePriceIdMonthly?: string;
  stripePriceIdAnnual?: string;
}

export const ENTERPRISE_FLOOR_PRICE = 499;
export const ANNUAL_DISCOUNT_MONTHS_FREE = 2;

export const PLANS: Record<PlanCode, PlanDef> = {
  SCOUT: {
    code: 'SCOUT',
    name: 'Scout',
    tagline: 'Try it before you buy it',
    priceMonthly: 0,
    revealQuota: 5,
    roofMeasurementQuota: 0,
    overageRevealCents: 150,
    overageRoofCents: null,
    fairUseRevealCeiling: 25,
    features: [
      { label: 'Live storm map (Madison County)', status: 'live' },
      { label: 'County-wide storm alerts', status: 'live' },
      { label: '5 property reveals / month included', status: 'live' },
      { label: 'Up to 20 extra reveals at $1.50 each (25/mo hard cap)', status: 'live' },
      { label: 'Owner name (contact info masked)', status: 'live' },
      { label: '1-year storm history', status: 'live' },
      { label: 'DataConfidence transparency on every estimate', status: 'live' },
      { label: 'View-only — no Lead pipeline', status: 'live' },
    ],
    entitlements: {
      maxSeats: 1,
      countyAccess: 'one-fixed',
      ownerContactReveal: false,
      dncScrub: false,
      leadPipeline: 'view-only',
      mobileFieldCapture: false,
      stormHistoryYears: 1,
      alertGranularity: 'county',
      leadScoring: 'none',
      canvassingRoutes: 'none',
      bulkPreReveal: false,
      teamAnalytics: false,
      funnelAnalytics: false,
      permitOverlay: false,
      territoryLocking: false,
      brandedReports: false,
      apiAccess: false,
      webhooks: false,
      crmSync: false,
      auditLog: false,
      dedicatedCsm: false,
      supportTier: 'docs',
    },
  },
  BUSINESS: {
    code: 'BUSINESS',
    name: 'Business',
    tagline: 'Solo roofers and single-truck operators',
    priceMonthly: 99,
    revealQuota: 50,
    roofMeasurementQuota: 5,
    overageRevealCents: 100,
    overageRoofCents: 200,
    fairUseRevealCeiling: 500,
    features: [
      { label: '50 property reveals / month ($1 each over)', status: 'live' },
      { label: 'Full owner contact: phone, email, mailing address', status: 'live' },
      { label: 'TCPA-safe: DNC scrub on every reveal', status: 'live' },
      { label: 'Solo Lead pipeline (Kanban)', status: 'live' },
      { label: 'Hot / Warm / Cold lead tiers', status: 'live' },
      { label: 'Mobile field-capture with GPS quick-capture', status: 'live' },
      { label: '1 county map (your choice)', status: 'live' },
      { label: '1 canvassing route/day with printable door sheet', status: 'live' },
      { label: 'Zip-code level storm alerts', status: 'live' },
      { label: '5-year storm history + hail exposure index', status: 'live' },
      { label: '5 roof measurement credits / month', status: 'live' },
      { label: 'CSV lead export', status: 'live' },
    ],
    entitlements: {
      maxSeats: 1,
      countyAccess: 'one-user-chosen',
      ownerContactReveal: true,
      dncScrub: true,
      leadPipeline: 'solo',
      mobileFieldCapture: true,
      stormHistoryYears: 5,
      alertGranularity: 'zip',
      leadScoring: 'buckets',
      canvassingRoutes: 'one-per-day',
      bulkPreReveal: false,
      teamAnalytics: false,
      funnelAnalytics: false,
      permitOverlay: false,
      territoryLocking: false,
      brandedReports: false,
      apiAccess: false,
      webhooks: false,
      crmSync: false,
      auditLog: false,
      dedicatedCsm: false,
      supportTier: 'email',
    },
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    tagline: 'Small teams running active outbound (3-5 reps)',
    priceMonthly: 249,
    revealQuota: 200,
    roofMeasurementQuota: 15,
    overageRevealCents: 50,
    overageRoofCents: 150,
    fairUseRevealCeiling: 1500,
    highlight: true,
    features: [
      { label: 'Everything in Business, plus:', status: 'live' },
      { label: '200 property reveals / month ($0.50 each over)', status: 'live' },
      { label: 'Up to 5 team seats with per-rep lead assignment', status: 'live' },
      { label: 'Full 0–100 lead scoring (replaces Hot/Warm/Cold)', status: 'live' },
      { label: 'All counties in your active metro', status: 'live' },
      { label: 'Property-level push alerts (real-time SSE worklist)', status: 'live' },
      { label: 'Unlimited canvassing routes', status: 'live' },
      { label: 'Bulk pre-canvass: reveal a hail zone in one click', status: 'live' },
      { label: 'Team leaderboard + per-rep dashboards', status: 'live' },
      { label: 'Conversion funnel + lead-decay analytics', status: 'live' },
      { label: 'Permit / new-construction overlay', status: 'live' },
      { label: '10-year storm history', status: 'live' },
      { label: '15 roof measurement credits / month', status: 'live' },
      { label: 'Email + chat support', status: 'live' },
    ],
    entitlements: {
      maxSeats: 5,
      countyAccess: 'all-active',
      ownerContactReveal: true,
      dncScrub: true,
      leadPipeline: 'multi-user',
      mobileFieldCapture: true,
      stormHistoryYears: 10,
      alertGranularity: 'property',
      leadScoring: 'unified-100',
      canvassingRoutes: 'unlimited',
      bulkPreReveal: true,
      teamAnalytics: true,
      funnelAnalytics: true,
      permitOverlay: true,
      territoryLocking: false,
      brandedReports: false,
      apiAccess: false,
      webhooks: false,
      crmSync: false,
      auditLog: false,
      dedicatedCsm: false,
      supportTier: 'email-chat',
    },
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Multi-state crews and large operations (10+ reps)',
    priceMonthly: 499,
    revealQuota: 2500,
    roofMeasurementQuota: 40,
    overageRevealCents: 25,
    overageRoofCents: 100,
    fairUseRevealCeiling: 15000,
    features: [
      { label: 'Everything in Pro, plus:', status: 'live' },
      { label: '2,500 reveals / month ($0.25 each over, fair-use 15k)', status: 'live' },
      { label: 'Unlimited team seats', status: 'live' },
      { label: 'All metros (multi-state coverage)', status: 'live' },
      { label: 'Full storm history archive', status: 'live' },
      { label: 'Custom storm alert rules + saved searches', status: 'live' },
      { label: 'Audit log of reveals (compliance defense)', status: 'live' },
      { label: '40 roof measurement credits / month', status: 'live' },
      { label: 'Territory locking — prevent rep overlap', status: 'soon' },
      { label: 'Team routing + GPS tracking', status: 'soon' },
      { label: 'White-label branded report PDFs', status: 'soon' },
      { label: 'Custom lead scoring rules', status: 'soon' },
      { label: 'REST API access + webhooks', status: 'soon' },
      { label: 'AccuLynx / SalesRabbit / Spotio sync', status: 'soon' },
      { label: 'Onboarding session + dedicated account manager', status: 'live' },
      { label: 'Quarterly business review (QBR)', status: 'live' },
      { label: 'Priority chat + phone support', status: 'live' },
    ],
    entitlements: {
      maxSeats: Number.POSITIVE_INFINITY,
      countyAccess: 'all-metros',
      ownerContactReveal: true,
      dncScrub: true,
      leadPipeline: 'multi-user',
      mobileFieldCapture: true,
      stormHistoryYears: 99,
      alertGranularity: 'custom-rules',
      leadScoring: 'custom-rules',
      canvassingRoutes: 'unlimited',
      bulkPreReveal: true,
      teamAnalytics: true,
      funnelAnalytics: true,
      permitOverlay: true,
      territoryLocking: true,
      brandedReports: true,
      apiAccess: true,
      webhooks: true,
      crmSync: true,
      auditLog: true,
      dedicatedCsm: true,
      supportTier: 'priority',
    },
  },
};

const LEGACY_PLAN_MAP: Record<string, PlanCode> = {
  STARTER: 'SCOUT',
  PROFESSIONAL: 'BUSINESS',
  ENTERPRISE: 'ENTERPRISE',
  SCOUT: 'SCOUT',
  BUSINESS: 'BUSINESS',
  PRO: 'PRO',
};

export function resolvePlan(orgPlan: string | null | undefined): PlanDef {
  const code = LEGACY_PLAN_MAP[orgPlan || 'STARTER'] || 'SCOUT';
  return PLANS[code];
}

export function planByCode(code: string): PlanDef | null {
  const c = LEGACY_PLAN_MAP[code];
  return c ? PLANS[c] : null;
}

export function entitlementOf(orgPlan: string | null | undefined): PlanEntitlements {
  return resolvePlan(orgPlan).entitlements;
}
