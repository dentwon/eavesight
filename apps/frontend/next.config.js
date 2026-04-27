/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// Security headers applied to every route. CSP is environment-aware:
// production drops `unsafe-eval` (Next.js 14 prod bundles don't need it —
// only HMR/React Refresh in dev does). `unsafe-inline` for scripts stays
// until middleware emits per-request nonces (planned follow-up).
//
// `form-action` includes only `'self'` — Stripe Checkout opens via
// stripe.js client-side, no cross-origin form post needed.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(self), usb=(), accelerometer=(), gyroscope=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  // HSTS is also set by Cloudflare — duplicating here is harmless and gives
  // us defense if traffic ever bypasses CF.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Scripts: self + Stripe.js. `unsafe-eval` only in dev (HMR).
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://js.stripe.com`,
      // Styles: 'unsafe-inline' until styled-jsx + Tailwind use nonces.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      // Images: self + map tile providers (Carto, OSM) + data: for tiny placeholders.
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.openstreetmap.org https://images.unsplash.com",
      // Map vector tiles + protomaps + our API + Stripe.
      "connect-src 'self' https://api.eavesight.com https://*.basemaps.cartocdn.com https://api.stripe.com https://checkout.stripe.com",
      // PMTiles fetched as workers/blobs.
      "worker-src 'self' blob:",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join('; '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  // Drop the X-Powered-By: Next.js banner — useful only to attackers
  // fingerprinting the stack.
  poweredByHeader: false,
  // TODO(security): flip to `false` once existing type errors are cleaned up.
  // Silently shipping type errors hides regressions in role/auth code.
  typescript: { ignoreBuildErrors: true },
  env: {
    NEXT_PUBLIC_API_URL: '/api',
    NEXT_PUBLIC_MAP_PROVIDER: 'maplibre',
    NEXT_PUBLIC_MAP_STYLE_URL: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  images: {
    // Migrated from deprecated `domains` to `remotePatterns`. The dead
    // `api.eavesight.app` entry (note `.app`, not `.com`) was a typo and
    // pointed to nothing; removed.
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'api.eavesight.com' },
      { protocol: 'https', hostname: 'app.eavesight.com' },
      { protocol: 'https', hostname: 'eavesight.com' },
    ],
  },
};

module.exports = nextConfig;
