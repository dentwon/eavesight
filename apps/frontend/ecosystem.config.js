module.exports = {
  apps: [{
    name: 'eavesight-frontend',
    cwd: '/home/dentwon/Eavesight/apps/frontend',
    script: 'npm',
    args: 'start',
    env: {
      HOST: '0.0.0.0',
      PORT: '80'
    }
  }]
}