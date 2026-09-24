/**
 * pm2 process definition for the Technical Council backend on EC2.
 *
 * A non-root user cannot bind port 80, so the app listens on 3000 and
 * iptables redirects 80 -> 3000 (see deploy/user-data.sh, step 5).
 *
 * Deployed layout on the instance:
 *   /opt/tc-app/backend/dist/server.js      <- the compiled app
 *   /opt/tc-app/backend/node_modules        <- npm ci --omit=dev
 *   /opt/tc-app/frontend/dist               <- built frontend, served by Express
 *   /opt/tc-app/deploy/ecosystem.config.js  <- this file
 */
module.exports = {
  apps: [
    {
      name: "tc-backend",
      script: "backend/dist/server.js",

      // pm2 resolves a relative `script` against this, so the app always starts
      // from /opt/tc-app no matter where `pm2 start` was invoked.
      cwd: "/opt/tc-app",

      instances: 1,
      exec_mode: "fork",

      // No secrets here. The app reads them from SSM Parameter Store at boot,
      // using the EC2 instance role via the default AWS credential chain.
      env: {
        NODE_ENV: "production",
        SSM_PATH: "/tc-events/prod/",
        AWS_REGION: "ap-south-1",
        PORT: 3000,
      },

      // pm2 redirects stdout/stderr here (merge_logs sends both to out_file);
      // the CloudWatch agent tails these two files.
      out_file: "/var/log/tc-app/out.log",
      error_file: "/var/log/tc-app/err.log",
      merge_logs: true,
      time: true,

      autorestart: true,
      max_restarts: 10,
      min_uptime: "20s",

      // Let pm2 send SIGINT and wait for the app's own graceful shutdown
      // (server.close + pool.end) before killing it.
      kill_timeout: 12000,
      listen_timeout: 8000,
    },
  ],
};
