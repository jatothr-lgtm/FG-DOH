# FG DOH Dashboard

Real-time Finished Goods Days on Hand dashboard for Farmley.  
Pulls live data from Google Sheets via Apps Script → displays on Vercel.

---

## Architecture

```
Google Sheet  →  Apps Script (Web App API)  →  Next.js /api/doh  →  Dashboard UI
     ↑                    ↓
  Edit sheet         Cache 5 min
  triggers           invalidated
  cache clear        on sheet edit
```

---

## Setup: 3 Steps

---

### Step 1 — Deploy Google Apps Script

1. Open your Google Sheet
2. Go to **Extensions → Apps Script**
3. Delete any existing code and paste the entire contents of `Code.gs`
4. Replace `YOUR_GOOGLE_SHEET_ID_HERE` with your actual Sheet ID  
   *(Found in the sheet URL: `docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`)*
5. Click **Deploy → New Deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. Click **Deploy** → Copy the Web App URL (looks like `https://script.google.com/macros/s/AKfyc.../exec`)

**Add the edit trigger:**
1. In Apps Script, click **Triggers** (clock icon on left)
2. Click **+ Add Trigger**
3. Function: `onSheetEdit`
4. Event source: `From spreadsheet`
5. Event type: `On edit`
6. Save

---

### Step 2 — Deploy to Vercel

**Option A: Via Vercel CLI**
```bash
npm install -g vercel
cd fg-doh-dashboard
npm install
vercel
# Follow prompts, then set env variable:
vercel env add NEXT_PUBLIC_APPS_SCRIPT_URL
# Paste your Apps Script URL when prompted
vercel --prod
```

**Option B: Via GitHub + Vercel UI**
1. Push this folder to a GitHub repo
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. In **Environment Variables**, add:
   - Key: `NEXT_PUBLIC_APPS_SCRIPT_URL`
   - Value: Your Apps Script Web App URL
4. Click **Deploy**

---

### Step 3 — Verify

1. Open your Vercel URL
2. You should see your live FG DOH data
3. Edit the Google Sheet → within 5 minutes the dashboard refreshes  
   *(The cache is cleared instantly on edit, so next visitor gets fresh data)*

---

## FG DOH Calculation

```
Average Daily Demand  =  SUM(SO Stock Qty in KG)  ÷  COUNT(Unique SO Dates)
                         [grouped by Item Code + Origin]

FG DOH  =  Inhand Stock Qty (KG)  ÷  Average Daily Demand
```

### Status Thresholds

| Status | DOH Range | Action |
|--------|-----------|--------|
| 🔴 Critical | 0–3 days | Urgent replenishment |
| 🟠 Low | 4–7 days | Initiate production order |
| 🟡 Watch | 8–15 days | Monitor closely |
| 🟢 Healthy | 16–30 days | Normal |
| 🔵 Overstocked | > 30 days | Risk of expiry (8-month shelf life) |
| ⚫ Dead Stock | No demand ever | Review for disposal |
| ⚪ No Recent Demand | No orders in 30 days | Investigate |
| ⛔ Stockout | 0 inhand | Emergency replenishment |

---

## Dashboard Features

- 🔄 **Auto-refresh** every 5 minutes
- 🔍 **Search** by item name, code, or group
- 🏭 **Filter** by Origin (Indore / UD Foods / Purnea / Rebela / Udupi)
- 📊 **Filter** by Status (Critical / Low / Healthy etc.)
- ↕️ **Sort toggle** — Critical first or Healthy first
- 📋 **Expandable rows** — click any row for full details
- 📦 **Summary cards** — count by status at a glance
- 🎨 **Color-coded** DOH bars for instant visual scanning

---

## Local Development

```bash
cd fg-doh-dashboard
npm install
# Copy .env.local.example to .env.local and set your URL
# Or leave blank — dashboard runs with mock/demo data
npm run dev
# Open http://localhost:3000
```

---

## Sheet Column Requirements

**"sales order" tab:**  
`Sales Order No.`, `Sales Order Date`, `Customer`, `Customer Group`, `Item Code`, `Item Name`, `Stock Qty`, `Stock UOM`, `Qty`, `UOM`, `NEW MIS ITEM GROUP`, `Origin`

**"Inhand " tab (note trailing space):**  
`Item Code`, `Item Name`, `Item Group`, `Value`, `Age`, `Stock Qty`, `ware house`, `Origin`

> ⚠️ Sheet names are case-sensitive. "Inhand " has a trailing space — match exactly.
