module.exports = {
  apps: [{
    name: 'stormvault-frontend',
    script: '/home/dentwon/StormVault/node_modules/.bin/next',
    args: 'start -p 3000 -H 0.0.0.0',
    cwd: '/home/dentwon/StormVault/apps/frontend',
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'http://192.168.86.230:4000',
      NEXT_PUBLIC_APP_URL: 'http://192.168.86.230:3000',
      NEXT_PUBLIC_MAP_PROVIDER: 'maplibre',
      NEXT_PUBLIC_MAP_STYLE_URL: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    },
    instances: 1,
    autorestart: true,
    watch: false,
  }],
};
