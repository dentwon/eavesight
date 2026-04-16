/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  images: {
    domains: ['images.unsplash.com', 'api.stormvault.app'],
  },
}
module.exports = nextConfig
