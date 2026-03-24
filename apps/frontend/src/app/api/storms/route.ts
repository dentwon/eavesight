// Mock API route for storms
import { NextResponse } from 'next/server';

const storms = [
  { id: '1', type: 'HAIL', severity: 'SEVERE', date: '2024-04-02T00:00:00Z', county: 'Madison', city: 'Huntsville', lat: 34.7304, lon: -86.5854, description: 'Severe hail storm with 2" hail' },
  { id: '2', type: 'HAIL', severity: 'MODERATE', date: '2024-04-02T00:00:00Z', county: 'Madison', city: 'Hazel Green', lat: 34.7431, lon: -86.5689, description: 'Moderate hail reported' },
  { id: '3', type: 'TORNADO', severity: 'EXTREME', date: '2024-03-25T00:00:00Z', county: 'Madison', city: 'Huntsville', lat: 34.7250, lon: -86.5600, description: 'EF-2 tornado touched down' },
  { id: '4', type: 'WIND', severity: 'SEVERE', date: '2024-05-15T00:00:00Z', county: 'Madison', city: 'New Hope', lat: 34.5387, lon: -86.3980, description: 'Severe wind gusts 70+ mph' },
  { id: '5', type: 'HAIL', severity: 'LIGHT', date: '2024-06-08T00:00:00Z', county: 'Madison', city: 'Gurley', lat: 34.7034, lon: -86.3744, description: 'Light hail, minor damage' },
  { id: '6', type: 'WIND', severity: 'MODERATE', date: '2024-07-22T00:00:00Z', county: 'Limestone', city: 'Athens', lat: 34.8034, lon: -86.9717, description: 'Moderate wind damage to roofs' },
  { id: '7', type: 'HAIL', severity: 'SEVERE', date: '2024-08-03T00:00:00Z', county: 'Madison', city: 'Toney', lat: 34.7131, lon: -86.7367, description: 'Severe hail 1.5" diameter' },
  { id: '8', type: 'Hail', severity: 'SEVERE', date: '2026-02-14T00:00:00Z', county: 'Madison', city: 'Huntsville', lat: 34.6800, lon: -86.5500, description: 'Severe hail storm, tennis ball sized' },
  { id: '9', type: 'WIND', severity: 'MODERATE', date: '2026-03-01T00:00:00Z', county: 'Madison', city: 'New Market', lat: 34.9084, lon: -86.4317, description: 'Moderate storm damage' },
  { id: '10', type: 'HAIL', severity: 'LIGHT', date: '2026-03-10T00:00:00Z', county: 'Madison', city: 'Brownsboro', lat: 34.7400, lon: -86.4700, description: 'Light hail, no significant damage' },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get('state') || 'AL';
  const limit = parseInt(searchParams.get('limit') || '100');

  const filtered = storms.filter(s => s.lat && s.lon).slice(0, limit);

  return NextResponse.json({
    data: filtered,
    meta: { total: filtered.length, limit, offset: 0, hasMore: false },
  });
}
