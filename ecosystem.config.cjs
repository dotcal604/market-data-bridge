// pm2 ecosystem config — auto-restarts bridge on crash
// Usage:
//   npm i -g pm2            (one-time)
//   pm2 start ecosystem.config.cjs
//   pm2 logs market-bridge  (tail logs)
//   pm2 stop market-bridge  (stop)
//   pm2 startup             (auto-start on Windows boot)
//   pm2 save                (persist process list)
//
// Parallel paper instance:
//   pm2 start ecosystem.config.cjs --only market-bridge-paper
//   pm2 logs market-bridge-paper
//
// Both simultaneously:
//   pm2 start ecosystem.config.cjs
//
// Log rotation (one-time setup):
//   pm2 install pm2-logrotate
//   pm2 set pm2-logrotate:max_size 50M
//   pm2 set pm2-logrotate:retain 7
//   pm2 set pm2-logrotate:compress true
//   pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
//   pm2 set pm2-logrotate:workerInterval 3600

const sharedConfig = {
  script: "build/index.js",
  cwd: __dirname,
  args: "--mode both",
  node_args: "--max-old-space-size=512",
  autorestart: true,
  max_restarts: 100,
  min_uptime: "10s",
  restart_delay: 5000,
  exp_backoff_restart_delay: 1000,
  max_memory_restart: "512M",
  merge_logs: true,
  log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  watch: false,
  kill_timeout: 10000,
};

module.exports = {
  apps: [
    {
      ...sharedConfig,
      name: "market-bridge",
      env: {
        NODE_ENV: "production",
        IBKR_PORT: "7496",      // TWS Live
        REST_PORT: "3000",
        IBKR_CLIENT_ID: "0",
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
    },
    {
      ...sharedConfig,
      name: "market-bridge-paper",
      env: {
        NODE_ENV: "production",
        IBKR_PORT: "7497",      // TWS Paper
        REST_PORT: "3001",
        IBKR_CLIENT_ID: "10",   // Different base to avoid clientId collisions
        DB_PATH: "data/bridge-paper.db",  // Separate DB for paper trades
      },
      error_file: "logs/pm2-paper-error.log",
      out_file: "logs/pm2-paper-out.log",
    },
  ],
};
