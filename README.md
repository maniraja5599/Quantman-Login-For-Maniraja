# Quantman broker login automation

Automates daily login to [Quantman](https://www.quantman.trade/) with **Flattrade** and **Kotak Neo**.

## Flattrade flow

1. Open Quantman → click **Signup / Login** (or Login).
2. Search for **Flattrade** and select it.
3. Enter **Client ID** and click **Login**.
4. In the auth popup: fill **User ID**, **Password**, **OTP/TOTP** (or DOB), then click **Log In**.

## Kotak Neo flow

1. Open Quantman → click Login.
2. Search for **Kotak Neo** and select it.
3. Enter **Client ID** and click **Login**.
4. In the Kotak auth popup: fill **User ID / Mobile**, **Password**, **OTP/TOTP**, then submit.

## Setup

1. **Node.js** (v18+): [nodejs.org](https://nodejs.org/).

2. **Install dependencies:**
   ```bash
   npm install
   npx playwright install chromium
   ```

3. **Credentials:** copy `.env.example` to `.env` and set Flattrade and/or Kotak Neo values. You can also set them in the **Settings** page of the web app. Do not commit `.env`.

## Web app (dashboard)

```bash
npm start
```

Open **http://localhost:3333**. From the **Brokers** page you can trigger Flattrade and Kotak Neo logins (headless or visible). **Settings** lets you update credentials; **Status** shows last run summary.

## Run (CLI)

- **Flattrade:** `npm run flattrade` (headless) or `npm run flattrade:headed`
- **Kotak Neo:** `npm run kotakneo` (headless) or `npm run kotakneo:headed`

Output is JSON with `success`, `step`, and `error`. Exit code `0` on success, `1` on failure.

## Run daily (Windows Task Scheduler)

Create a daily task that runs `node scripts/flattrade-login.js` and/or `node scripts/kotak-neo-login.js` with **Start in** set to this project folder. Run `npx playwright install chromium` once from that folder.
