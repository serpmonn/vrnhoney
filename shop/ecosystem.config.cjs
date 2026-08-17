module.exports = {
  apps: [{
    name: 'vrnhoney-shop',
    cwd: '/var/www/vrnhoney-shop',
    script: 'server/index.mjs',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
    },
    max_restarts: 20,
    restart_delay: 2000,
  }],
};
