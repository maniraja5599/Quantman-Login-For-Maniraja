# FiFTO - Quantman Broker Login Automation

Automates daily login to [Quantman](https://www.quantman.trade/) with **Flattrade** and **Kotak Neo** brokers. Includes a web dashboard, Telegram notifications, and daily scheduling.

## Features

- Automated Flattrade & Kotak Neo login via Playwright
- Web dashboard (Brokers, Status, Automation, Settings pages)
- Daily scheduler with start/pause/stop and pause-days
- Telegram notifications for login results & schedule changes
- Activity log with persistent history
- PM2 process management for 24/7 uptime

---

## Local Setup

1. **Node.js** v18+ required: [nodejs.org](https://nodejs.org/)

2. Install dependencies:
   ```bash
   npm install
   npx playwright install chromium
   ```

3. Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   nano .env
   ```

4. Start the server:
   ```bash
   npm start
   ```
   Open **http://localhost:3333**

---

## Deploy on Oracle Cloud Free Tier (Always Free, 24/7)

Oracle Cloud gives you a **free VM forever** (ARM or AMD) with enough power to run this server + Playwright.

### Step 1: Create Oracle Cloud Account

1. Go to [cloud.oracle.com](https://cloud.oracle.com/) and sign up
2. You need a credit/debit card for verification, but **you will NOT be charged** on the free tier
3. Choose your home region (closest to you, e.g., Mumbai for India)

### Step 2: Create a Free VM

1. Go to **Compute > Instances > Create Instance**
2. Configure:
   - **Name:** `fifto-server`
   - **Image:** Ubuntu 22.04 (or 24.04)
   - **Shape:** Pick one of these free options:
     - `VM.Standard.E2.1.Micro` (AMD, 1 CPU, 1 GB RAM) - Always Free
     - `VM.Standard.A1.Flex` (ARM, up to 4 CPU, 24 GB RAM) - Always Free
     - **Recommended:** ARM with 2 CPU, 4 GB RAM
   - **Networking:** Use default VCN or create one. Ensure **public IP** is assigned
   - **SSH Key:** Download the private key or paste your public key
3. Click **Create** and wait for it to start

### Step 3: Open Port 3333 in Oracle Cloud Firewall

Oracle has **two firewalls** - you must open the port in both:

**A. Security List (Cloud level):**
1. Go to **Networking > Virtual Cloud Networks** > click your VCN
2. Click **Security Lists** > **Default Security List**
3. Click **Add Ingress Rules**:
   - Source CIDR: `0.0.0.0/0`
   - Destination Port: `3333`
   - Protocol: TCP
4. Save

**B. VM iptables (OS level)** - handled by the setup script automatically.

### Step 4: Connect to Your VM via SSH

```bash
# From your local terminal (replace with your key and IP)
ssh -i ~/path/to/your-private-key.key ubuntu@<YOUR-VM-PUBLIC-IP>
```

On Windows, use PuTTY or Windows Terminal:
```powershell
ssh -i C:\Users\manir\.ssh\oracle-key.key ubuntu@<YOUR-VM-PUBLIC-IP>
```

### Step 5: Clone and Setup

```bash
# On the Oracle VM:
cd ~
git clone https://github.com/<YOUR-USERNAME>/fifto-server.git
cd fifto-server

# Run the setup script (installs Node, Chromium, PM2, dependencies)
chmod +x setup-oracle.sh
./setup-oracle.sh
```

### Step 6: Configure Credentials

```bash
nano .env
```

Fill in your broker credentials, Telegram bot token, and chat ID. Save with `Ctrl+X, Y, Enter`.

### Step 7: Start the Server with PM2

```bash
# Start the server (runs in background, survives SSH disconnect)
pm2 start ecosystem.config.cjs

# Make it auto-start on VM reboot
pm2 save
pm2 startup
# Copy and run the command it prints (starts with sudo)
```

### Step 8: Access Your Dashboard

Open in browser: `http://<YOUR-VM-PUBLIC-IP>:3333`

---

## PM2 Commands

| Command | Description |
|---------|-------------|
| `pm2 status` | Check if server is running |
| `pm2 logs fifto` | View live logs |
| `pm2 restart fifto` | Restart server |
| `pm2 stop fifto` | Stop server |
| `pm2 monit` | Monitor CPU/RAM usage |

## Updating the Server

```bash
cd ~/fifto-server
git pull
npm install
pm2 restart fifto
```

---

## Push to GitHub (from your local PC)

```bash
# Create a PRIVATE repo on github.com first, then:
git remote add origin https://github.com/<YOUR-USERNAME>/fifto-server.git
git branch -M main
git push -u origin main
```

> Use a **private repo** since `.env.example` contains partial credentials.

---

## CLI Usage

- **Flattrade:** `npm run flattrade` (headless) or `npm run flattrade:headed`
- **Kotak Neo:** `npm run kotakneo` (headless) or `npm run kotakneo:headed`

---

## Developer

Built by **Mani Raja** - [Instagram](https://www.instagram.com/maniraja__/?hl=en)
