// PM2 process definition for the Next.js frontend.
//
// Public URLs are sourced from environment variables so this file is portable
// across machines (local dev, VM, cloud). Set PROD_API_HOST + PROD_APP_HOST
// (or NEXT_PUBLIC_API_URL / NEXT_PUBLIC_APP_URL) on the host before
// `pm2 start ecosystem.frontend.config.js`. Localhost defaults are safe for
// single-machine dev.
const apiHost = process.env.PROD_API_HOST || 'http://localhost:4000';
const appHost = process.env.PROD_APP_HOST || 'http://localhost:3000';

module.exports = {
  apps: [{
    name: 'eavesight-frontend',
    script: './node_modules/.bin/next',
    args: 'start -p 3000 -H 0.0.0.0',
    cwd: './apps/frontend',
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || apiHost,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || appHost,
      NEXT_PUBLIC_MAP_PROVIDER: 'maplibre',
      NEXT_PUBLIC_MAP_STYLE_URL: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    },
    instances: 1,
    autorestart: true,
    watch: false,
  }],
};
