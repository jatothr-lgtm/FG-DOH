// ============================================================
// FG DOH Dashboard - Google Apps Script (Web App API)
// Deploy as: Execute as "Me", Who has access "Anyone"
// ============================================================

const SPREADSHEET_ID = "1oVaIjl_UxFFLdCJsnNqY8oo4F5ecaxToYnwQjEHr_v4"; 
const SO_SHEET_NAME = "Sales Order";      // Tab 1 — exact casing in your sheet
const INHAND_SHEET_NAME = "Inhand";       // Tab 2 — trailing space handled by getSheetFuzzy
const CACHE_KEY = "fg_doh_data";
const CACHE_DURATION = 300; // 5 minutes cache

/**
 * Case-insensitive, trim-tolerant sheet lookup.
 * Handles "Sales Order" / "sales order" / "Inhand" / "Inhand " etc.
 */
function getSheetFuzzy(ss, name) {
  if (!ss) return null; // Safety check
  const target = String(name).trim().toLowerCase();
  const sheets = ss.getSheets();
  // 1. Try exact match first (fastest)
  const exact = ss.getSheetByName(name);
  if (exact) return exact;
  // 2. Trim + case-insensitive fallback
  for (const s of sheets) {
    if (s.getName().trim().toLowerCase() === target) return s;
  }
  return null;
}

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
  const soSheet     = getSheetFuzzy(ss, SO_SHEET_NAME);
  const inhandSheet = getSheetFuzzy(ss, INHAND_SHEET_NAME);

  if (!soSheet) {
    return jsonResponse({ error: `Sheet '${SO_SHEET_NAME}' not found. Available: ${SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().map(s=>s.getName()).join(', ')}` }, 404);
  }
  if (!inhandSheet) {
    return jsonResponse({ error: `Sheet '${INHAND_SHEET_NAME}' not found. Available: ${SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().map(s=>s.getName()).join(', ')}` }, 404);
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

    const soQtyUnits = parseFloat(row["Qty"]) || 0; // Units column from SO tab

    const key = `${itemCode}|||${origin}`;
    if (!soMap[key]) {
      soMap[key] = { totalQty: 0, totalQtyUnits: 0, uniqueDates: new Set(), itemName, itemCode, origin };
    }
    soMap[key].totalQty += stockQty;
    soMap[key].totalQtyUnits += soQtyUnits;
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
    const stockQty  = parseFloat(row["Stock Qty"]) || 0; // KGS
    const stockUnits = parseFloat(row["Qty"])       || 0; // UNT (new column)

    if (!itemCode || !origin) return;

    const key = `${itemCode}|||${origin}`;
    if (!inhandMap[key]) {
      inhandMap[key] = {
        inhandQty:    0,
        inhandUnits:  0,
        itemName,
        itemCode,
        origin,
        itemGroup: String(row["Item Group"] || "").trim(),
        value:     parseFloat(row["Value"]) || 0,
        age:       parseFloat(row["Age"])   || 0,
        warehouse: String(row["ware house"] || "").trim()
      };
    }
    inhandMap[key].inhandQty    += stockQty;
    inhandMap[key].inhandUnits  += stockUnits;
  });

  // --- Step 4: Combine and compute DOH ---
  const rows = [];
  const allKeys = new Set([...Object.keys(inhandMap), ...Object.keys(soMap)]);

  allKeys.forEach(key => {
    const [itemCode, origin] = key.split("|||");
    const ih = inhandMap[key];
    const so = soMap[key];

    if (!ih) return; // Skip items not in inhand (we focus on inhand DOH)

    const inhandQty   = ih.inhandQty;
    const inhandUnits = ih.inhandUnits;
    const hasRecentDemand = recentKeys.has(key);

    // ── KG mode ──────────────────────────────────────────────
    let avgDailyDemand = 0;
    let totalSoQty     = 0;
    let uniqueDays     = 0;

    if (so) {
      uniqueDays     = so.uniqueDates.size;
      totalSoQty     = so.totalQty;
      avgDailyDemand = uniqueDays > 0 ? totalSoQty / uniqueDays : 0;
    }

    let fgDoh = null, status = "";
    if (!so || avgDailyDemand === 0) {
      status = "Dead Stock";
    } else if (!hasRecentDemand) {
      status = "No Recent Demand";
    } else if (inhandQty === 0) {
      status = "Stockout"; fgDoh = 0;
    } else {
      fgDoh = Math.round((inhandQty / avgDailyDemand) * 100) / 100;
      if      (fgDoh <=  3) status = "Critical";
      else if (fgDoh <=  7) status = "Low";
      else if (fgDoh <= 15) status = "Watch";
      else if (fgDoh <= 30) status = "Healthy";
      else                   status = "Overstocked";
    }

    // ── Units mode ───────────────────────────────────────────
    let totalSoQtyUnits     = 0;
    let avgDailyDemandUnits = 0;
    if (so) {
      totalSoQtyUnits     = so.totalQtyUnits || 0;
      avgDailyDemandUnits = uniqueDays > 0 ? totalSoQtyUnits / uniqueDays : 0;
    }

    let fgDohUnits = null, statusUnits = "";
    if (!so || avgDailyDemandUnits === 0) {
      statusUnits = "Dead Stock";
    } else if (!hasRecentDemand) {
      statusUnits = "No Recent Demand";
    } else if (inhandUnits === 0) {
      statusUnits = "Stockout"; fgDohUnits = 0;
    } else {
      fgDohUnits = Math.round((inhandUnits / avgDailyDemandUnits) * 100) / 100;
      if      (fgDohUnits <=  3) statusUnits = "Critical";
      else if (fgDohUnits <=  7) statusUnits = "Low";
      else if (fgDohUnits <= 15) statusUnits = "Watch";
      else if (fgDohUnits <= 30) statusUnits = "Healthy";
      else                        statusUnits = "Overstocked";
    }

    rows.push({
      itemCode,
      itemName:  ih.itemName,
      origin,
      itemGroup: ih.itemGroup,
      warehouse: ih.warehouse,
      value:     ih.value,
      age:       ih.age,
      // ── KG fields ──
      inhandQty:       Math.round(inhandQty   * 100) / 100,
      totalSoQty:      Math.round(totalSoQty  * 100) / 100,
      uniqueDays,
      avgDailyDemand:  Math.round(avgDailyDemand  * 100) / 100,
      fgDoh,
      status,
      // ── Units fields ──
      inhandUnits:          Math.round(inhandUnits         * 100) / 100,
      totalSoQtyUnits:      Math.round(totalSoQtyUnits     * 100) / 100,
      avgDailyDemandUnits:  Math.round(avgDailyDemandUnits * 100) / 100,
      fgDohUnits,
      statusUnits,
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
