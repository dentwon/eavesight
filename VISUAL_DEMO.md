# Eavesight Visual Implementation Demo

## 🖥️ Landing Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌───┐                                                                     │
│  │ ☁ │ Eavesight                     Features  Pricing  About  Sign In    │
│  └───┘                                [Get Started]                        │
│                                                                             │
│         ⭐ Now in Beta — First 100 users get 3 months free                  │
│                                                                             │
│    Find More Roofing Jobs with Storm Intelligence                          │
│                                                                             │
│    Eavesight combines storm damage data, property insights, and lead       │
│    management into one powerful platform. Stop wasting hours researching    │
│    leads.                                                                   │
│                                                                             │
│                   [Start Free Trial]    [Watch Demo]                        │
│                                                                             │
│                                                                             │
│    ┌─────────────────────────────────────────────────────────────────────┐  │
│    │  ┌─┐ ┌─┐ ┌─┐    Huntsville, AL area    5 Active Storms               │  │
│    │  │●│ │●│ │●│  ┌─────────────────────────────────────────────────────┐ │  │
│    │  └─┘ └─┘ └─┘  │                                                     │ │  │
│    │               │  [Map Visualization with storm markers]             │ │  │
│    │               │                                                     │ │  │
│    │               └─────────────────────────────────────────────────────┘ │  │
│    │                                                                     │  │
│    │  ┌──────┐  ┌──────┐  ┌──────┐                                        │  │
│    │  │  47  │  │ 203  │  │  12  │                                        │  │
│    │  │Leads │  │Props │  │Prior │                                        │  │
│    │  └──────┘  └──────┘  └──────┘                                        │  │
│    └─────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📊 Dashboard Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Dashboard  Leads  Properties  Settings              John Contractor        │
│                                    ┌─────────────┐                          │
│                                    │ Profile Pic │                          │
│                                    └─────────────┘                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  [Total Leads: 8]  [Jobs Won: 1]  [Storms (30d): 15]  [Win Rate: 13%]  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                                                                         ││
│  │                 MAP VISUALIZATION                                       ││
│  │                                                                         ││
│  │  [Huntsville, AL Map with storm markers and lead pins]                  ││
│  │                                                                         ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Recent Leads                                                            ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ ● Lisa Taylor  •  Huntsville, AL  •  CONTACTED  •  MEDIUM               ││
│  │ ● Robert Wilson  •  Huntsville, AL  •  NEW  •  LOW                      ││
│  │ ● Jennifer Miller  •  Huntsville, AL  •  WON  •  MEDIUM                 ││
│  │ ● David Davis  •  Madison, AL  •  NEGOTIATING  •  HIGH                  ││
│  │ ● Emily Brown  •  Madison, AL  •  QUOTED  •  MEDIUM                     ││
│  │                                                                         ││
│  │ [View all leads →]                                                      ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📋 Lead Management Interface

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Dashboard  Leads  Properties  Settings              John Contractor        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Filters: [All Status ↓] [All Priority ↓] [Search...]                       │
│                                                                             │
│  ┌─────────┬──────────────┬──────────┬──────────┬────────────┬──────────┐  │
│  │ Name    │ Property     │ Status   │ Priority │ Last Update│ Actions  │  │
│  ├─────────┼──────────────┼──────────┼──────────┼────────────┼──────────┤  │
│  │John Smith│123 Oak St   │ NEW      │ HIGH     │ 2026-03-24 │ Edit     │  │
│  │Sarah John│456 Maple Ave│ CONTACTED│ MEDIUM   │ 2026-03-24 │ Edit     │  │
│  │Michael Wil│789 Pine Rd │ QUALIFIED│ HIGH     │ 2026-03-24 │ Edit     │  │
│  │Emily Brown│321 Cedar Ln│ QUOTED   │ MEDIUM   │ 2026-03-24 │ Edit     │  │
│  │David Davis│654 Elm Ct  │ NEGOTIAT.│ HIGH     │ 2026-03-24 │ Edit     │  │
│  │Jennifer Mi│987 Birch Dr│ WON      │ MEDIUM   │ 2026-03-24 │ Edit     │  │
│  │Robert Wils│147 Willow Wy│ NEW     │ LOW      │ 2026-03-24 │ Edit     │  │
│  │Lisa Taylor│852 Poplar St│ CONTACTED│ MEDIUM   │ 2026-03-24 │ Edit     │  │
│  └─────────┴──────────────┴──────────┴──────────┴────────────┴──────────┘  │
│                                                                             │
│  [← Prev] 1 [Next →]                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🗺️ Property Search & Storm Mapping

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Dashboard  Leads  Properties  Settings              John Contractor        │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Search: [Address, City, Zip...] [Search Button]                           │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Map Controls:                                                           ││
│  │ ┌─────────┐                                                             ││
│  │ │ Layers  │  [All] [Storms] [Leads]                                     ││
│  │ └─────────┘                                                             ││
│  │                                                                         ││
│  │                 INTERACTIVE MAP                                         ││
│  │                                                                         ││
│  │  [Huntsville/Decatur Area Map with Property Pins]                       ││
│  │                                                                         ││
│  │                                                                         ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ Property Results                                                        ││
│  ├─────────────────────────────────────────────────────────────────────────┤│
│  │ ● 123 Oak Street, Huntsville, AL  •  Built: 1985  •  Roof Age: 18 yrs   ││
│  │   [Last Storm: Hail - Apr 2, 2024]                                      ││
│  │ ● 456 Maple Avenue, Huntsville, AL  •  Built: 1992  •  Roof Age: 8 yrs  ││
│  │   [Last Storm: Tornado - Mar 25, 2024]                                  ││
│  │ ● 789 Pine Road, Huntsville, AL  •  Built: 1978  •  Roof Age: 22 yrs    ││
│  │   [Last Storm: Hail - Apr 2, 2024]                                      ││
│  │                                                                         ││
│  │ [Load More Properties]                                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📈 Analytics Dashboard

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Dashboard  Leads  Properties  Analytics  Settings          John Contractor │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │    LEAD STATS       │  │   STORM IMPACT      │  │   PERFORMANCE       │ │
│  │  ┌─────────────┐    │  │  ┌─────────────┐    │  │  ┌─────────────┐    │ │
│  │  │ Total: 8    │    │  │  │ Storms: 15  │    │  │  │ Conversion  │    │ │
│  │  │ New: 2      │    │  │  │ This Month  │    │  │  │ Rate: 13%   │    │ │
│  │  │ Contacted: 2│    │  │  └─────────────┘    │  │  └─────────────┘    │ │
│  │  │ Quoted: 1   │    │  │                     │  │                     │ │
│  │  │ Won: 1      │    │  │  HAIL: 8 events     │  │  Revenue Trend      │ │
│  │  │ Lost: 0     │    │  │  TORNADO: 3 events  │  │  ┌─────────────┐    │ │
│  │  └─────────────┘    │  │  WIND: 4 events     │  │  │ $12K        │    │ │
│  └─────────────────────┘  │                     │  │  │ $10K    ●   │    │ │
│                           │  ┌─────────────┐    │  │  │ $8K   ● ●   │    │ │
│                           │  │Most Affected│    │  │  │ $6K ● ● ●   │    │ │
│                           │  │Areas        │    │  │  │ $4K●●●●●    │    │ │
│                           │  │1.Huntsville │    │  │  │ $2K●●●●●●   │    │ │
│                           │  │2.Madison    │    │  │  │ $0 ●●●●●●●  │    │ │
│                           │  │3.Athens     │    │  │  └─0──1──2──3──4─┘ │ │
│                           │  └─────────────┘    │  │    Feb Mar Apr May  │ │
│                           └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🔧 Technical Implementation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  DATA FLOW DIAGRAM                                                          │
│                                                                             │
│  NOAA Storm Events API                                                      │
│          │                                                                  │
│          ▼                                                                  │
│  ┌─────────────────┐                                                       │
│  │ Storm Data Sync │                                                       │
│  │ (Scheduled Task)│                                                       │
│  └─────────────────┘                                                       │
│          │                                                                  │
│          ▼                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                                │
│  │   PostgreSQL    │◄──►│  Property Data  │                                │
│  │   Database      │    │   (Sample Set)  │                                │
│  └─────────────────┘    └─────────────────┘                                │
│          │                        │                                         │
│          ▼                        ▼                                         │
│  ┌─────────────────┐    ┌─────────────────┐                                │
│  │   NestJS API    │◄──►│ Lead Management │                                │
│  │   (Backend)     │    │   System        │                                │
│  └─────────────────┘    └─────────────────┘                                │
│          │                                                                  │
│          ▼                                                                  │
│  ┌─────────────────┐                                                       │
│  │  Next.js App    │                                                       │
│  │  (Frontend)     │                                                       │
│  └─────────────────┘                                                       │
│          │                                                                  │
│          ▼                                                                  │
│  ┌─────────────────┐                                                       │
│  │   Web Browser   │                                                       │
│  │   (Users)       │                                                       │
│  └─────────────────┘                                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 💰 Pricing Page

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Features  Pricing  About  Sign In              [Get Started]              │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│           One Tool. Whole Pipeline.                                         │
│           Flat company pricing · Metered reveals · No per-user fees         │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐                      │
│  │    SCOUT    │  │  BUSINESS   │  │    PRO   ★      │                      │
│  │             │  │             │  │                 │                      │
│  │ Try It Free │  │ Solo / Crew │  │ Serious Outbound│                      │
│  │             │  │             │  │                 │                      │
│  │    Free     │  │    $99      │  │     $249        │                      │
│  │             │  │   /month    │  │    /month       │                      │
│  │             │  │             │  │                 │                      │
│  │5 reveals/mo │  │50 reveals   │  │200 reveals/mo   │                      │
│  │County alert │  │Zip alerts   │  │Property alerts  │                      │
│  │Basic data   │  │1 county map │  │Multi-county     │                      │
│  │             │  │Name+Mailing │  │Name+Phone+Mail  │                      │
│  │             │  │5 roof meas. │  │15 roof meas.    │                      │
│  │             │  │1 route/day  │  │Unlimited routes │                      │
│  │             │  │             │  │0–100 scoring    │                      │
│  │[Start Free] │  │[Free Trial] │  │[Free Trial]     │                      │
│  └─────────────┘  └─────────────┘  └─────────────────┘                      │
│                                                                             │
│  ENTERPRISE — Talk to Sales · Unlimited reveals · API · Territory locking   │
│  Team routing + GPS · 40 roof credits · Priority support                    │
│                                                                             │
│  ✓ No per-user fees  ✓ Cancel anytime  ✓ 14-day trial on paid plans         │
│  ★ Live promo: First 100 users get 3 months free                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

This visual representation shows exactly what's been implemented and how it all works together to create a complete, revenue-ready SaaS platform for roofing contractors.