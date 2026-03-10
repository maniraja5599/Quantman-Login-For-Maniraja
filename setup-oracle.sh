#!/bin/bash
set -e

echo "========================================="
echo "  FiFTO - Oracle Cloud Setup Script"
echo "========================================="
echo ""

# Update system
echo "[1/7] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
echo "[2/7] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "  Node: $(node -v)"
echo "  npm:  $(npm -v)"

# Install Playwright system dependencies (Chromium libs)
echo "[3/7] Installing Chromium dependencies..."
sudo apt install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2 libxshmfence1 \
  fonts-liberation fonts-noto-color-emoji xdg-utils

# Install PM2 globally
echo "[4/7] Installing PM2 process manager..."
sudo npm install -g pm2

# Install project dependencies
echo "[5/7] Installing project dependencies..."
npm install

# Install Playwright Chromium browser
echo "[6/7] Installing Playwright Chromium..."
npx playwright install chromium

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  echo "[7/7] Creating .env from example..."
  cp .env.example .env
  echo ""
  echo "  IMPORTANT: Edit .env with your real credentials:"
  echo "  nano .env"
  echo ""
else
  echo "[7/7] .env already exists, skipping."
fi

# Open firewall port
echo ""
echo "Opening port 3333 in iptables..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3333 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "  Next steps:"
echo ""
echo "  1. Edit your credentials:"
echo "     nano .env"
echo ""
echo "  2. Start the server:"
echo "     pm2 start ecosystem.config.cjs"
echo ""
echo "  3. Make it start on boot:"
echo "     pm2 save"
echo "     pm2 startup"
echo "     (run the command it prints)"
echo ""
echo "  4. Open in browser:"
echo "     http://<YOUR-VM-PUBLIC-IP>:3333"
echo ""
echo "  Useful PM2 commands:"
echo "     pm2 status        - check if running"
echo "     pm2 logs fifto    - view logs"
echo "     pm2 restart fifto - restart server"
echo "     pm2 stop fifto    - stop server"
echo ""
