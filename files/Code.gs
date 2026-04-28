// ============================================================
// FG DOH Dashboard - Google Apps Script (Web App API)
// Deploy as: Execute as "Me", Who has access "Anyone"
// ============================================================

const SPREADSHEET_ID = "YOUR_GOOGLE_SHEET_ID_HERE"; // Replace with your Sheet ID
const SO_SHEET_NAME = "sales order";
const INHAND_SHEET_NAME = "Inhand ";
const CACHE_KEY = "fg_doh_data";
const CACHE_DURATION = 300; // 5 minutes cache

function doGet(e) {
  try {
    const action = e.parameter.action || "getData";

    if (action === "getData") {
      return handleGetData();
    } else if (action === "ping") {
      return jsonResponse({ status: "ok", timestamp: new Date().toISOString() });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    return jsonResponse({ error: err.message, stack: err.stack }, 500);
  }
}

function handleGetData() {
  // Try cache first
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    const parsed = JSON.parse(cached);
    parsed._cached = true;
    return jsonResponse(parsed);
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const soSheet = ss.getSheetByName(SO_SHEET_NAME);
  const inhandSheet = ss.getSheetByName(INHAND_SHEET_NAME);

  if (!soSheet || !inhandSheet) {
    return jsonResponse({ error: "Sheet not found. Check sheet names." }, 404);
  }

  // --- Read Sales Order data ---
  const soData = sheetToObjects(soSheet);
  // --- Read Inhand data ---
  const inhandData = sheetToObjects(inhandSheet);

  // --- Compute DOH ---
  const result = computeFgDoh(soData, inhandData);

  // Cache the result
  try {
    cache.put(CACHE_KEY, JSON.stringify(result), CACHE_DURATION);
  } catch (e) {
    // Cache might be too large, skip
  }

  return jsonResponse(result);
}

function sheetToObjects(sheet) {
  const [headers, ...rows] = sheet.getDataRange().getValues();
  return rows
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[String(h).trim()] = row[i];
      });
      return obj;
    });
}

function computeFgDoh(soData, inhandData) {
  const now = new Date();

  // --- Step 1: Build SO aggregation per Item Code + Origin ---
  // Key: "ItemCode|||Origin"
  const soMap = {}; // key -> { totalQty, uniqueDates: Set, itemName }

  soData.forEach(row => {
    const itemCode = String(row["Item Code"] || "").trim();
    const origin = String(row["Origin"] || "").trim();
    const itemName = String(row["Item Name"] || "").trim();
    const stockQty = parseFloat(row["Stock Qty"]) || 0;
    const rawDate = row["Sales Order Date"];

    if (!itemCode || !origin) return;

    let dateStr = "";
    if (rawDate instanceof Date) {
      dateStr = rawDate.toISOString().split("T")[0];
    } else if (rawDate) {
      dateStr = String(rawDate).split("T")[0].split(" ")[0];
    }

    const key = `${itemCode}|||${origin}`;
    if (!soMap[key]) {
      soMap[key] = { totalQty: 0, uniqueDates: new Set(), itemName, itemCode, origin };
    }
    soMap[key].totalQty += stockQty;
    if (dateStr) soMap[key].uniqueDates.add(dateStr);
  });

  // --- Step 2: Check last-30-day demand ---
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 30);

  const recentKeys = new Set();
  soData.forEach(row => {
    const itemCode = String(row["Item Code"] || "").trim();
    const origin = String(row["Origin"] || "").trim();
    const rawDate = row["Sales Order Date"];
    let d = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (!isNaN(d) && d >= cutoff) {
      recentKeys.add(`${itemCode}|||${origin}`);
    }
  });

  // --- Step 3: Build Inhand aggregation per Item Code + Origin ---
  const inhandMap = {}; // key -> { inhandQty, itemName, itemGroup, value, age, warehouse }

  inhandData.forEach(row => {
    const itemCode = String(row["Item Code"] || "").trim();
    const origin = String(row["Origin"] || "").trim();
    const itemName = String(row["Item Name"] || "").trim();
    const stockQty = parseFloat(row["Stock Qty"]) || 0;

    if (!itemCode || !origin) return;

    const key = `${itemCode}|||${origin}`;
    if (!inhandMap[key]) {
      inhandMap[key] = {
        inhandQty: 0,
        itemName,
        itemCode,
        origin,
        itemGroup: String(row["Item Group"] || "").trim(),
        value: parseFloat(row["Value"]) || 0,
        age: parseFloat(row["Age"]) || 0,
        warehouse: String(row["ware house"] || "").trim()
      };
    }
    inhandMap[key].inhandQty += stockQty;
  });

  // --- Step 4: Combine and compute DOH ---
  const rows = [];
  const allKeys = new Set([...Object.keys(inhandMap), ...Object.keys(soMap)]);

  allKeys.forEach(key => {
    const [itemCode, origin] = key.split("|||");
    const ih = inhandMap[key];
    const so = soMap[key];

    if (!ih) return; // Skip items not in inhand (we focus on inhand DOH)

    const inhandQty = ih.inhandQty;
    const hasRecentDemand = recentKeys.has(key);

    let avgDailyDemand = 0;
    let totalSoQty = 0;
    let uniqueDays = 0;

    if (so) {
      uniqueDays = so.uniqueDates.size;
      totalSoQty = so.totalQty;
      avgDailyDemand = uniqueDays > 0 ? totalSoQty / uniqueDays : 0;
    }

    let fgDoh = null;
    let status = "";

    if (!so || avgDailyDemand === 0) {
      status = "Dead Stock";
      fgDoh = null;
    } else if (!hasRecentDemand) {
      status = "No Recent Demand";
      fgDoh = null;
    } else if (inhandQty === 0) {
      status = "Stockout";
      fgDoh = 0;
    } else {
      fgDoh = Math.round((inhandQty / avgDailyDemand) * 100) / 100;
      if (fgDoh <= 3) status = "Critical";
      else if (fgDoh <= 7) status = "Low";
      else if (fgDoh <= 15) status = "Watch";
      else if (fgDoh <= 30) status = "Healthy";
      else status = "Overstocked";
    }

    rows.push({
      itemCode,
      itemName: ih.itemName,
      origin,
      itemGroup: ih.itemGroup,
      warehouse: ih.warehouse,
      value: ih.value,
      age: ih.age,
      inhandQty: Math.round(inhandQty * 100) / 100,
      totalSoQty: Math.round(totalSoQty * 100) / 100,
      uniqueDays,
      avgDailyDemand: Math.round(avgDailyDemand * 100) / 100,
      fgDoh,
      status,
      hasRecentDemand
    });
  });

  // Sort by fgDoh ascending (Critical first), nulls last
  rows.sort((a, b) => {
    if (a.fgDoh === null && b.fgDoh === null) return 0;
    if (a.fgDoh === null) return 1;
    if (b.fgDoh === null) return -1;
    return a.fgDoh - b.fgDoh;
  });

  return {
    data: rows,
    meta: {
      totalItems: rows.length,
      generatedAt: now.toISOString(),
      origins: [...new Set(rows.map(r => r.origin))].sort(),
      itemGroups: [...new Set(rows.map(r => r.itemGroup).filter(Boolean))].sort(),
      _cached: false
    }
  };
}

function jsonResponse(data, code) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

// ============================================================
// TRIGGER: Auto-invalidate cache when sheet is edited
// In Apps Script editor: Triggers > Add Trigger
// Function: onSheetEdit, Event: From spreadsheet > On edit
// ============================================================
function onSheetEdit(e) {
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_KEY);
  Logger.log("Cache invalidated due to sheet edit at: " + new Date().toISOString());
}
