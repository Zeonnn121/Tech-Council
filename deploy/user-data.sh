#!/bin/bash
#
# EC2 user data for the Technical Council backend.
#
#   Target OS : Amazon Linux 2023
#   Region    : ap-south-1
#
# Used both as Launch Template user data and for the first manual instance.
# Every step checks before it acts, so re-running the script is safe.
#
# Prerequisite: deploy/build-and-upload.ps1 has already uploaded
#   s3://$BUCKET_NAME/deploy/app.tar.gz
#   s3://$BUCKET_NAME/deploy/cloudwatch-agent-config.json
#
# There are no hard-coded credentials anywhere in this file: the AWS CLI and the
# app both use the EC2 instance role through the default credential chain.

set -euxo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# EDIT ME — the one value you must set before using this script.
BUCKET_NAME="your-bucket-name"
# ─────────────────────────────────────────────────────────────────────────────

REGION="ap-south-1"
APP_DIR="/opt/tc-app"
LOG_DIR="/var/log/tc-app"
APP_PORT="3000"
APP_USER="ec2-user"
CW_CONFIG_PATH="/opt/aws/amazon-cloudwatch-agent/etc/tc-app-config.json"

# ── 1. Node.js 20 (NodeSource RPM) ───────────────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20.* ]]; then
  curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
  dnf install -y nodejs
fi

# ── 2. pm2 (global) and the CloudWatch agent ─────────────────────────────────
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
dnf install -y amazon-cloudwatch-agent

# ── 3. Create the log and application directories ────────────────────────────
mkdir -p "$LOG_DIR" "$APP_DIR"
chown "$APP_USER:$APP_USER" "$LOG_DIR"

# ── 4. Download and extract the application bundle ───────────────────────────
aws s3 cp "s3://${BUCKET_NAME}/deploy/app.tar.gz" /tmp/app.tar.gz --region "$REGION"

# Clear any previous deployment so a re-run is a clean replace.
find "$APP_DIR" -mindepth 1 -delete
tar -xzf /tmp/app.tar.gz -C "$APP_DIR"
rm -f /tmp/app.tar.gz

# The archive is extracted by root, but npm and pm2 run as ec2-user and need to
# write node_modules.
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ── 5. Install production dependencies only ──────────────────────────────────
sudo -u "$APP_USER" bash -lc "cd ${APP_DIR}/backend && npm ci --omit=dev"

# ── 6. Redirect port 80 -> 3000 ──────────────────────────────────────────────
# pm2 runs as a non-root user, which cannot bind a privileged port. User data
# re-applies this on every new instance (so ASG scale-out is fine), but a manual
# `reboot` of an existing instance does not re-run user data — re-run this
# script if that happens.
if ! iptables -t nat -C PREROUTING -p tcp --dport 80 -j REDIRECT --to-port "$APP_PORT" 2>/dev/null; then
  iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port "$APP_PORT"
fi

# ── 7. Start the app under pm2 as ec2-user ───────────────────────────────────
sudo -u "$APP_USER" bash -lc "cd ${APP_DIR} && pm2 start ${APP_DIR}/deploy/ecosystem.config.js"
sudo -u "$APP_USER" bash -lc "pm2 save"

# Register pm2 with systemd so the app survives a reboot. PATH must include the
# node bin directory or the generated unit will not be able to find pm2.
NODE_BIN_DIR="$(dirname "$(command -v node)")"
env PATH="${PATH}:${NODE_BIN_DIR}" pm2 startup systemd -u "$APP_USER" --hp "/home/${APP_USER}"
systemctl enable "pm2-${APP_USER}" || true

# ── 8. Start the CloudWatch agent with the shipped config ────────────────────
mkdir -p "$(dirname "$CW_CONFIG_PATH")"
aws s3 cp "s3://${BUCKET_NAME}/deploy/cloudwatch-agent-config.json" "$CW_CONFIG_PATH" --region "$REGION"

/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s \
  -c "file:${CW_CONFIG_PATH}"

echo "==> user data complete: tc-backend listening on :${APP_PORT}, redirected from :80"
