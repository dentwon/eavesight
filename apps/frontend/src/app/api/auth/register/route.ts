// Mock API route for auth register
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const { email, password, firstName, lastName, organizationName } = await request.json();

  // Mock registration
  if (email && password) {
    return NextResponse.json({
      access_token: 'mock-jwt-token-' + Date.now(),
      user: {
        id: String(Date.now()),
        email,
        firstName: firstName || '',
        lastName: lastName || '',
        role: 'USER',
        orgId: 'new-org-' + Date.now(),
      },
    });
  }

  return NextResponse.json({ message: 'Registration failed' }, { status: 400 });
}
