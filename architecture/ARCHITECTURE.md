# Eavesight Technical Architecture

**Version 1.0 | March 2026**

---

## System Overview

Eavesight is a modern, cloud-native B2B SaaS application designed for scalability, reliability, and cost efficiency. The architecture follows a modular approach to allow rapid iteration and easy maintenance.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Web App   │  │  Mobile App │  │   Third-party Integrations│ │
│  │  (Next.js)  │  │   (React    │  │  (Webhooks, API Access)  │  │
│  │             │  │   Native)    │  │                          │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼──────────────────────┼───────────────┘
          │                │                      │
          └────────────────┼──────────────────────┘
                           │ HTTPS
┌──────────────────────────┼───────────────────────────────────────┐
│                     API GATEWAY LAYER                             │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    NestJS REST API                           │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │ │
│  │  │ Auth Module  │ │ Storm Module │ │ Property Module     │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐ │ │
│  │  │ Lead Module  │ │ User Module  │ │ Analytics Module     │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐
│   DATA LAYER    │  │   CACHE LAYER  │  │   EXTERNAL SERVICES     │
│  ┌───────────┐  │  │  ┌─────────┐  │  │  ┌──────────────────┐   │
│  │ PostgreSQL│  │  │  │  Redis  │  │  │  │  NOAA APIs       │   │
│  │  + PostGIS│  │  │  └─────────┘  │  │  └──────────────────┘   │
│  └───────────┘  │                 │  │  ┌──────────────────┐   │
│  ┌───────────┐  │                 │  │  │ Property APIs    │   │
│  │ S3 Storage│  │                 │  │  │ (Estated/Smarty) │   │
│  └───────────┘  │                 │  │  └──────────────────┘   │
│                 │                 │  │  ┌──────────────────┐   │
│                 │                 │  │  │ Map Services      │   │
│                 │                 │  │  │ (MapLibre/OSM)   │   │
└─────────────────┴─────────────────┴──┴─────────────────────────┘
```

---

## Technology Stack

### Frontend

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14+ | React framework with SSR |
| TypeScript | 5.x | Type safety |
| TailwindCSS | 3.x | Utility-first styling |
| shadcn/ui | Latest | Component library |
| MapLibre GL | 4.x | Open-source mapping |
| TanStack Query | 5.x | Data fetching & caching |
| Zustand | 4.x | Client state management |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| NestJS | 10+ | Node.js framework |
| TypeScript | 5.x | Type safety |
| Prisma | 5.x | ORM |
| PostgreSQL | 14+ | Primary database |
| PostGIS | 3.x | Geospatial extensions |
| Redis | 7.x | Caching & queues |
| Passport.js | - | Authentication |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| Vercel | Frontend hosting |
| Railway/Render | Backend hosting |
| AWS S3 | File storage |
| Cloudflare | CDN & DNS |
| Sentry | Error monitoring |

---

## Database Schema

### Core Entities

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    users     │     │ organizations│     │ organization_│
│              │     │              │     │   _members    │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │────<│ id           │     │ user_id      │
│ email        │     │ name         │     │ org_id       │
│ password_hash│     │ plan         │     │ role         │
│ role         │     │ created_at   │     │ created_at   │
│ created_at   │     │ updated_at   │     └──────────────┘
└──────────────┘     └──────────────┘
                           │
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
       ▼                   ▼                   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  properties  │     │  storm_events│     │    leads     │
│              │     │              │     │              │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id           │     │ id           │     │ id           │
│ address      │     │ type         │     │ org_id       │
│ city         │     │ severity     │     │ property_id  │
│ state        │     │ geom         │     │ status       │
│ zip          │     │ date         │     │ assignee_id  │
│ lat          │     │ description  │     │ notes        │
│ lon          │     │ source       │     │ score        │
│ year_built   │     │ created_at   │     │ created_at   │
│ parcel_id    │     └──────────────┘     │ updated_at   │
│ roof_age     │                             └──────────────┘
│ created_at   │
└──────────────┘
```

### Property-Storm Relationship

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  properties  │     │ property_storms  │     │ storm_events│
│              │     │                  │     │              │
├──────────────┤     ├──────────────────┤     ├──────────────┤
│ id           │────<│ property_id      │     │ id           │
│ ...          │     │ storm_event_id  │────>│ ...          │
└──────────────┘     │ distance_meters │     └──────────────┘
                     │ affected        │
                     │ created_at      │
                     └──────────────────┘
```

---

## API Design

### RESTful Endpoints

#### Authentication
```
POST   /api/auth/register     - Register new user
POST   /api/auth/login        - User login
POST   /api/auth/logout       - User logout
POST   /api/auth/refresh      - Refresh access token
GET    /api/auth/me           - Get current user
```

#### Users
```
GET    /api/users             - List users (admin)
GET    /api/users/:id         - Get user by ID
PATCH  /api/users/:id         - Update user
DELETE /api/users/:id         - Delete user (admin)
```

#### Organizations
```
GET    /api/orgs              - List user's organizations
POST   /api/orgs              - Create organization
GET    /api/orgs/:id          - Get organization
PATCH  /api/orgs/:id          - Update organization
DELETE /api/orgs/:id          - Delete organization
POST   /api/orgs/:id/members  - Add member
DELETE /api/orgs/:id/members  - Remove member
```

#### Properties
```
GET    /api/properties        - Search properties
GET    /api/properties/:id    - Get property details
POST   /api/properties/lookup - Quick lookup by address
GET    /api/properties/:id/roof-age - Get roof age estimate
```

#### Storm Events
```
GET    /api/storms            - List storm events
GET    /api/storms/:id        - Get storm details
GET    /api/storms/nearby     - Get storms near location
GET    /api/storms/active     - Get currently active storms
POST   /api/storms/sync       - Sync from NOAA (internal)
```

#### Leads
```
GET    /api/leads             - List leads
POST   /api/leads             - Create lead
GET    /api/leads/:id         - Get lead details
PATCH  /api/leads/:id         - Update lead
DELETE /api/leads/:id         - Delete lead
POST   /api/leads/:id/convert - Convert to customer
POST   /api/leads/bulk        - Bulk create leads
```

#### Analytics
```
GET    /api/analytics/overview     - Dashboard overview
GET    /api/analytics/leads       - Lead analytics
GET    /api/analytics/storms      - Storm impact analytics
GET    /api/analytics/conversion  - Conversion metrics
```

### Request/Response Format

**Request**
```json
{
  "headers": {
    "Authorization": "Bearer <jwt_token>",
    "Content-Type": "application/json"
  },
  "body": {
    "address": "123 Main St",
    "city": "Dallas",
    "state": "TX",
    "zip": "75201"
  }
}
```

**Response**
```json
{
  "success": true,
  "data": {
    "id": "prop_123",
    "address": "123 Main St",
    "city": "Dallas",
    "state": "TX",
    "zip": "75201",
    "lat": 32.7767,
    "lon": -96.7970,
    "yearBuilt": 1985,
    "roofAge": 12,
    "parcelId": "123456789"
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-24T06:00:00Z"
  }
}
```

**Error Response**
```json
{
  "success": false,
  "error": {
    "code": "PROPERTY_NOT_FOUND",
    "message": "No property found at this address",
    "details": {}
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-03-24T06:00:00Z"
  }
}
```

---

## Security Architecture

### Authentication Flow

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │     │  Next.js│     │  NestJS │     │  Redis  │
│ Browser │     │   App   │     │   API   │     │ Session │
└────┬────┘     └────┬────┘     └────┬────┘     └────┬────┘
     │               │               │               │
     │ 1. Login      │               │               │
     │──────────────>│               │               │
     │               │ 2. Validate   │               │
     │               │──────────────>│               │
     │               │               │ 3. Check      │
     │               │               │──────────────>│
     │               │               │               │
     │               │               │ 4. JWT Token │
     │               │<───────────────│               │
     │               │               │               │
     │ 5. Store      │               │               │
     │   Token       │               │               │
     │<──────────────│               │               │
     │               │               │               │
     │ 6. API Call   │               │               │
     │   (with JWT)   │               │               │
     │──────────────>│──────────────>│               │
     │               │               │               │
     │ 7. Response    │               │               │
     │<──────────────│<──────────────│               │
```

### Token Strategy

- **Access Token**: JWT, 15-minute expiry, contains user ID and roles
- **Refresh Token**: Opaque, 7-day expiry, stored in Redis
- **Session**: Server-side in Redis, linked to refresh token

### Security Measures

| Layer | Protection |
|-------|------------|
| Transport | HTTPS/TLS 1.3, HSTS |
| API | Rate limiting, CORS, Helmet.js |
| Auth | JWT, bcrypt, MFA support |
| Data | Encryption at rest, PII masking |
| Infrastructure | WAF, DDoS protection, VPC |

---

## Caching Strategy

### Cache Tiers

```
┌─────────────────────────────────────────────────────────┐
│                    L1: In-Memory                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ TanStack Query (client)                              │ │
│  │ • Cached responses per query                         │ │
│  │ • 5 minute stale time                                │ │
│  │ • Background refetch on window focus                │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    L2: Redis                             │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ • API response caching (5 min - 1 hour)             │ │
│  │ • Session storage                                    │ │
│  │ • Rate limit counters                                │ │
│  │ • Storm event data (1 hour TTL)                     │ │
│  │ • Property lookups (24 hour TTL)                    │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    L3: PostgreSQL                         │
│  │ • Persistent data                                    │ │
│  │ • User/organization data                             │ │
│  │ • Lead records                                        │ │
│  │ • Audit logs                                         │ │
└─────────────────────────────────────────────────────────┘
```

### Cache Invalidation

| Event | Action |
|-------|--------|
| Lead updated | Invalidate lead list caches |
| Property updated | Invalidate property cache |
| Storm sync | Invalidate storm caches |
| User logout | Invalidate session cache |

---

## Deployment Architecture

### Environment Strategy

```
┌─────────────────────────────────────────────────────────┐
│                     DEVELOPMENT                          │
│  • Local Docker Compose                                  │
│  • Hot reload                                            │
│  • Mock external services                                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                       STAGING                            │
│  • Railway Preview Deployment                            │
│  • Mirror production config                              │
│  • Real API integrations                                 │
│  • Debug logging enabled                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      PRODUCTION                          │
│  • Vercel (frontend)                                     │
│  • Railway (backend)                                     │
│  • AWS S3 (files)                                        │
│  • Real APIs                                             │
│  • Monitoring & alerts                                   │
└─────────────────────────────────────────────────────────┘
```

### CI/CD Pipeline

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  Push   │───>│  Build  │───>│  Test   │───>│ Deploy  │
│  Code   │    │         │    │         │    │         │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                   │               │               │
                   ▼               ▼               ▼
              ┌─────────┐    ┌─────────┐    ┌─────────┐
              │Lint &   │    │ Unit    │    │ Staging │
              │Typecheck│    │ Tests   │    │   or    │
              └─────────┘    └─────────┘    │Production│
                                             └─────────┘
```

---

## Monitoring & Observability

### Logging Strategy

| Level | Use Case |
|-------|----------|
| Error | Failures, exceptions |
| Warn | Rate limits, retries |
| Info | API requests, user actions |
| Debug | Development, troubleshooting |

### Key Metrics

| Category | Metrics |
|----------|---------|
| Application | Response time, error rate, availability |
| Business | Signups, subscriptions, churn |
| Technical | API latency, cache hit rate, DB queries |
| Infrastructure | CPU, memory, disk usage |

### Alerting

| Severity | Condition | Action |
|----------|-----------|--------|
| Critical | Service down | PagerDuty |
| High | Error rate > 5% | Slack alert |
| Medium | Latency > 2s | Email |
| Low | Disk > 80% | Ticket |

---

## Scalability Considerations

### Horizontal Scaling

- Stateless API servers behind load balancer
- Database read replicas for queries
- Redis cluster for distributed caching
- CDN for static assets

### Vertical Scaling (Initial)

- Start with small instances
- Monitor resource usage
- Upgrade as needed

### Cost Optimization

- Reserved instances for baseline
- Spot instances for batch jobs
- Auto-scaling based on demand
- Right-sizing resources

---

## Disaster Recovery

### Backup Strategy

| Data | Frequency | Retention |
|------|-----------|-----------|
| Database | Hourly | 7 days |
| Database | Daily | 30 days |
| Files (S3) | Continuous | 90 days |

### Recovery Plan

1. **RTO (Recovery Time Objective)**: 4 hours
2. **RPO (Recovery Point Objective)**: 1 hour
3. **Failover**: Automatic to secondary region

---

*Architecture Document*
*Eavesight - March 2026*