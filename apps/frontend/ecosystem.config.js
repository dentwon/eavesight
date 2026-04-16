module.exports = {
  apps: [{
    name: 'stormvault-frontend',
    cwd: '/home/dentwon/StormVault/apps/frontend',
    script: 'npm',
    args: 'start',
    env: {
      HOST: '0.0.0.0',
      PORT: '80'
    }
  }]
}