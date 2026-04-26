module.exports = {
  apps: [
    {
      name: 'eavesight-backend',
      cwd: '/home/dentwon/Eavesight/apps/backend',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
    {
      name: 'eavesight-frontend',
      cwd: '/home/dentwon/Eavesight/apps/frontend',
      script: '../../node_modules/.bin/next',
      args: 'start -p 3000 -H 0.0.0.0',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
};
