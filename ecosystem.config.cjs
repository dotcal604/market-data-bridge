// pm2 ecosystem config — auto-restarts bridge on crash
// Usage:
//   npm i -g pm2            (one-time)
//   pm2 start ecosystem.config.cjs
//   pm2 logs market-bridge  (tail logs)
//   pm2 stop market-bridge  (stop)
//   pm2 startup             (auto-start on Windows boot)
//   pm2 save                (persist process list)
module.exports = {
  apps: [
    {
      name: "market-bridge",
      script: "build/index.js",
      cwd: __dirname,
      args: "--mode both",
      node_args: "--max-old-space-size=512",
      env: {
        NODE_ENV: "production",
      },
      // Auto-restart config
      autorestart: true,
      max_restarts: 100,        // max restarts in restart_delay window
      min_uptime: "10s",        // consider started if alive >10s
      restart_delay: 5000,      // 5s between restarts
      exp_backoff_restart_delay: 1000, // exponential backoff on repeated crashes

      // Memory guard — restart if bridge leaks past 512MB
      max_memory_restart: "512M",

      // Logging
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Watch mode OFF — we rebuild manually
      watch: false,

      // Kill timeout — give shutdown() time to flush
      kill_timeout: 10000,
    },
  ],
};
