// Mirror of apps/backend/src/common/plans.ts.
// Frontend version trades the backend's `entitlements` object for marketing
// affordances (priceDisplay, ctaLabel, ctaHref). Keep the price/quota numbers
// in sync — they are the single source of truth for billing math.

export type PlanCode = 'SCOUT' | 'BUSINESS' | 'PRO' | 'ENTERPRISE';

export interface FeatureBullet {
  label: string;
  status: 'live' | 'soon';
}

export interface PlanDef {
  code: PlanCode;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceDisplay: string;
  priceFinePrint: string;
  revealQuota: number;
  revealOverageDisplay: string | null;
  roofMeasurementQuota: number;
  fairUseRevealCeiling: number | null;
  highlight?: boolean;
  ctaLabel: string;
  ctaHref: string;
  features: FeatureBullet[];
}

export const PLAN_ORDER: PlanCode[] = ['SCOUT', 'BUSINESS', 'PRO', 'ENTERPRISE'];

export const PLANS: Record<PlanCode, PlanDef> = {
  SCOUT: {
    code: 'SCOUT',
    name: 'Scout',
    tagline: 'Try it before you buy it',
    priceMonthly: 0,
    priceDisplay: 'Free',
    priceFinePrint: 'No credit card to start. Pay-as-you-go reveals optional, capped at 25/mo.',
    revealQuota: 5,
    revealOverageDisplay: '$1.50 per reveal beyond 5 (hard cap 25/mo)',
    roofMeasurementQuota: 0,
    fairUseRevealCeiling: 25,
    ctaLabel: 'Start Free',
    ctaHref: '/signup?plan=scout',
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
  },
  BUSINESS: {
    code: 'BUSINESS',
    name: 'Business',
    tagline: 'Solo roofers and single-truck operators',
    priceMonthly: 99,
    priceDisplay: '$99',
    priceFinePrint: '$99/mo · 14-day free trial · No contract',
    revealQuota: 50,
    revealOverageDisplay: '$1.00 per reveal beyond 50',
    roofMeasurementQuota: 5,
    fairUseRevealCeiling: 500,
    ctaLabel: 'Start 14-day Trial',
    ctaHref: '/signup?plan=business',
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
  },
  PRO: {
    code: 'PRO',
    name: 'Pro',
    tagline: 'Small teams running active outbound (3–5 reps)',
    priceMonthly: 249,
    priceDisplay: '$249',
    priceFinePrint: '$249/mo · 14-day free trial · No contract',
    revealQuota: 200,
    revealOverageDisplay: '$0.50 per reveal beyond 200',
    roofMeasurementQuota: 15,
    fairUseRevealCeiling: 1500,
    highlight: true,
    ctaLabel: 'Start 14-day Trial',
    ctaHref: '/signup?plan=pro',
    features: [
      { label: 'Everything in Business, plus:', status: 'live' },
      { label: '200 property reveals / month ($0.50 each over)', status: 'live' },
      { label: 'Up to 5 team seats with per-rep lead assignment', status: 'live' },
      { label: 'Full 0–100 lead scoring (replaces Hot/Warm/Cold)', status: 'live' },
      { label: 'All counties in your active metro', status: 'live' },
      { label: 'Property-level push alerts (real-time worklist)', status: 'live' },
      { label: 'Unlimited canvassing routes', status: 'live' },
      { label: 'Bulk pre-canvass: reveal a hail zone in one click', status: 'live' },
      { label: 'Team leaderboard + per-rep dashboards', status: 'live' },
      { label: 'Conversion funnel + lead-decay analytics', status: 'live' },
      { label: 'Permit / new-construction overlay', status: 'live' },
      { label: '10-year storm history', status: 'live' },
      { label: '15 roof measurement credits / month', status: 'live' },
      { label: 'Email + chat support', status: 'live' },
    ],
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Multi-state crews and large operations (10+ reps)',
    priceMonthly: 499,
    priceDisplay: 'From $499',
    priceFinePrint: 'From $499/mo · Custom contracts above 15,000 reveals/mo',
    revealQuota: 2500,
    revealOverageDisplay: '$0.25 per reveal beyond 2,500',
    roofMeasurementQuota: 40,
    fairUseRevealCeiling: 15000,
    ctaLabel: 'Talk to Sales',
    ctaHref: '/signup?plan=enterprise',
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
