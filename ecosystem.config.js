'use strict';

/**
 * Konfiguracja PM2: `pm2 start ecosystem.config.js`.
 * /aktualizuj teraz (lub AUTO_UPDATE=true) konczy proces kodem 0 po `git pull`,
 * a PM2 dzieki autorestart uruchamia bota ponownie z nowym kodem.
 */
module.exports = {
  apps: [
    {
      name: 'hitmans-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
