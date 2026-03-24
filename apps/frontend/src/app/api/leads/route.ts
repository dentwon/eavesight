// Mock API route for leads
import { NextResponse } from 'next/server';

let leads = [
  { id: '1', firstName: 'John', lastName: 'Smith', email: 'john.smith@email.com', phone: '256-555-0101', status: 'NEW', priority: 'HIGH', address: '123 Oak Street', city: 'Huntsville', state: 'AL', zip: '35801', lat: 34.7250, lon: -86.5800, createdAt: '2026-03-20T10:00:00Z', property: { address: '123 Oak Street', city: 'Huntsville', yearBuilt: 1985 }, source: 'Map Search', notes: 'Interested in roof inspection after recent storms.' },
  { id: '2', firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.j@email.com', phone: '256-555-0102', status: 'CONTACTED', priority: 'MEDIUM', address: '456 Maple Avenue', city: 'Huntsville', state: 'AL', zip: '35801', lat: 34.7300, lon: -86.5850, createdAt: '2026-03-19T14:30:00Z', property: { address: '456 Maple Avenue', city: 'Huntsville', yearBuilt: 1992 }, source: 'Website', notes: 'Called but no answer. Will try again.' },
  { id: '3', firstName: 'Michael', lastName: 'Williams', email: 'mwilliams@email.com', phone: '256-555-0103', status: 'QUALIFIED', priority: 'HIGH', address: '789 Pine Road', city: 'Huntsville', state: 'AL', zip: '35802', lat: 34.7350, lon: -86.5900, createdAt: '2026-03-18T09:15:00Z', property: { address: '789 Pine Road', city: 'Huntsville', yearBuilt: 1978 }, source: 'Storm Alert', notes: 'Roof damaged in Feb storm. Needs full replacement.' },
  { id: '4', firstName: 'Emily', lastName: 'Brown', email: 'emily.brown@email.com', phone: '256-555-0104', status: 'QUOTED', priority: 'MEDIUM', address: '321 Cedar Lane', city: 'Madison', state: 'AL', zip: '35758', lat: 34.6993, lon: -86.7281, createdAt: '2026-03-15T11:00:00Z', property: { address: '321 Cedar Lane', city: 'Madison', yearBuilt: 2005 }, source: 'Referral', notes: 'Sent quote. Waiting for decision.' },
  { id: '5', firstName: 'David', lastName: 'Davis', email: 'david.d@email.com', phone: '256-555-0105', status: 'NEGOTIATING', priority: 'HIGH', address: '654 Elm Court', city: 'Madison', state: 'AL', zip: '35758', lat: 34.7050, lon: -86.7200, createdAt: '2026-03-10T16:45:00Z', property: { address: '654 Elm Court', city: 'Madison', yearBuilt: 2010 }, source: 'Door Knock', notes: 'Negotiating price. Interested but price sensitive.' },
  { id: '6', firstName: 'Jennifer', lastName: 'Miller', email: 'jmiller@email.com', phone: '256-555-0106', status: 'WON', priority: 'MEDIUM', address: '987 Birch Drive', city: 'Huntsville', state: 'AL', zip: '35803', lat: 34.6500, lon: -86.5500, createdAt: '2026-03-05T13:20:00Z', property: { address: '987 Birch Drive', city: 'Huntsville', yearBuilt: 1998 }, source: 'Website', notes: 'Signed contract! Job scheduled for next week.' },
  { id: '7', firstName: 'Robert', lastName: 'Wilson', email: 'rwilson@email.com', phone: '256-555-0107', status: 'NEW', priority: 'LOW', address: '147 Willow Way', city: 'Huntsville', state: 'AL', zip: '35810', lat: 34.7800, lon: -86.6000, createdAt: '2026-03-22T08:00:00Z', property: { address: '147 Willow Way', city: 'Huntsville', yearBuilt: 1982 }, source: 'Map Search', notes: 'New lead from storm alert.' },
  { id: '8', firstName: 'Lisa', lastName: 'Taylor', email: 'lisa.t@email.com', phone: '256-555-0108', status: 'CONTACTED', priority: 'MEDIUM', address: '852 Poplar Street', city: 'Athens', state: 'AL', zip: '35611', lat: 34.8034, lon: -86.9717, createdAt: '2026-03-20T15:30:00Z', property: { address: '852 Poplar Street', city: 'Athens', yearBuilt: 1990 }, source: 'Facebook', notes: 'Interested in inspection. Set appointment for tomorrow.' },
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100');
  const status = searchParams.get('status');

  let filtered = [...leads];
  if (status) {
    filtered = filtered.filter(l => l.status === status);
  }

  return NextResponse.json({
    data: filtered.slice(0, limit),
    meta: { total: filtered.length, limit, offset: 0, hasMore: false },
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const newLead = {
    id: String(leads.length + 1),
    ...body,
    status: body.status || 'NEW',
    priority: body.priority || 'MEDIUM',
    createdAt: new Date().toISOString(),
  };
  leads.unshift(newLead);

  return NextResponse.json(newLead, { status: 201 });
}
