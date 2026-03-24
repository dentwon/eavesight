// Mock API route for analytics overview
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    leads: {
      total: 8,
      new: 2,
      won: 1,
      conversionRate: 13,
    },
    properties: {
      total: 15,
    },
    storms: {
      last30Days: 3,
    },
  });
}
