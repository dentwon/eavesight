# StormVault - Roofing Intelligence Platform

**StormVault** is a B2B SaaS application designed for U.S. roofing professionals to identify high-potential leads using an integrated data intelligence platform.

## Overview

StormVault combines:
- 🗺️ Google Maps-style interface with parcel overlays
- 🌩️ Real-time and historical weather damage data (hail, wind, storm)
- 🏠 Property and ownership information
- 🧾 Building permit history and roof age modeling
- 📞 Homeowner contact data (DNC-filtered)
- 📊 Optional insurance & policy-related insights

## Quick Links

- [Business Plan](./BUSINESS_PLAN.md)
- [Market Research](./MARKET_RESEARCH.md)
- [SWOT Analysis](./SWOT.md)
- [Architecture](./architecture/)
- [API Documentation](./docs/)

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ with PostGIS extension
- Redis (for caching)
- Mapbox API key (or OpenStreetMap alternative)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/stormvault.git
cd stormvault

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Initialize database
npm run db:migrate

# Start development server
npm run dev
```

## Tech Stack

### Frontend
- Next.js 14 (React + TypeScript)
- TailwindCSS + shadcn/ui
- MapLibre GL (open-source maps)
- TanStack Query (state management)

### Backend
- NestJS (TypeScript)
- PostgreSQL + PostGIS
- Redis (caching)
- JWT Authentication

### Infrastructure
- Vercel (frontend hosting)
- Railway/Render (backend hosting)
- S3-compatible storage

## Features

### MVP Features (Phase 1)
1. Interactive map with storm event overlays
2. Property search and details
3. Lead management (create, assign, track)
4. Basic analytics dashboard
5. User authentication

### Future Features (Phase 2)
1. AI-powered roof age estimation
2. Insurance claim integration
3. Automated lead scoring
4. Mobile app for field teams

## License

Proprietary - All rights reserved