// Re-export the PLANS catalog with an explicit ordering. Backend owns the
// canonical source of truth; this file just adds the ordering used by the
// public /billing/plans endpoint.

import { PLANS, PlanCode } from '../common/plans';

export { PLANS };

export const PLAN_ORDER_LIST: PlanCode[] = ['SCOUT', 'BUSINESS', 'PRO', 'ENTERPRISE'];
