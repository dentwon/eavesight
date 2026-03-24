// Mock API route for auth login
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email, password } = await request.json();

  // Mock authentication - accept any email/password
  if (email && password) {
    return NextResponse.json({
      access_token: 'mock-jwt-token-' + Date.now(),
      user: {
        id: '1',
        email,
        firstName: 'Demo',
        lastName: 'User',
        role: 'USER',
        orgId: 'demo-org',
      },
    });
  }

  return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
}
