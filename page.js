"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  Critical:         { color: "#dc2626", bg: "rgba(220,38,38,0.13)",  border: "rgba(220,38,38,0.35)",  label: "Critical",          emoji: "🔴", order: 0 },
  Stockout:         { color: "#991b1b", bg: "rgba(153,27,27,0.18)",  border: "rgba(153,27,27,0.45)",  label: "Stockout",          emoji: "⛔", order: 1 },
  Low:              { color: "#ea580c", bg: "rgba(234,88,12,0.13)",  border: "rgba(234,88,12,0.35)",  label: "Low",               emoji: "🟠", order: 2 },
  Watch:            { color: "#ca8a04", bg: "rgba(202,138,4,0.13)",  border: "rgba(202,138,4,0.35)",  label: "Watch",             emoji: "🟡", order: 3 },
  Healthy:          { color: "#16a34a", bg: "rgba(22,163,74,0.13)",  border: "rgba(22,163,74,0.35)",  label: "Healthy",           emoji: "🟢", order: 4 },
  Overstocked:      { color: "#2563eb", bg: "rgba(37,99,235,0.13)",  border: "rgba(37,99,235,0.35)",  label: "Overstocked",       emoji: "🔵", order: 5 },
  "No Recent Demand":{ color: "#6b7280", bg: "rgba(107,114,128,0.1)", border: "rgba(107,114,128,0.3)", label: "No Recent Demand", emoji: "⚪", order: 6 },
  "Dead Stock":     { color: "#4b5563", bg: "rgba(75,85,99,0.1)",    border: "rgba(75,85,99,0.3)",    label: "Dead Stock",        emoji: "⚫", order: 7 },
};

function getDohColor(doh, status) {
  if (status === "Critical" || status === "Stockout") return "#dc2626";
  if (status === "Low") return "#ea580c";
  if (status === "Watch") return "#ca8a04";
  if (status === "Healthy") return "#16a34a";
  if (status === "Overstocked") return "#2563eb";
  return "#6b7280";
}

function DohBar({ doh, status }) {
  const max = 45;
  const pct = doh === null ? 0 : Math.min((doh / max) * 100, 100);
  const color = getDohColor(doh, status);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color, minWidth: 48, textAlign: "right", fontWeight: 600 }}>
        {doh === null ? "—" : `${doh}d`}
      </span>
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG["Dead Stock"];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      color: cfg.color, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", lineHeight: 1.4
    }}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12, padding: "16px 20px", flex: 1, minWidth: 120
    }}>
      <div style={{ fontSize: 12, color: "#8b95a5", marginBottom: 6, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, color: color || "#e8eaf0", fontFamily: "'DM Mono', monospace", lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#5a6474", marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, gap: 16 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        border: "3px solid rgba(59,130,246,0.2)",
        borderTopColor: "#3b82f6",
        animation: "spin 0.8s linear infinite"
      }} />
      <div style={{ color: "#8b95a5", fontSize: 13 }}>Fetching live data…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function Dashboard() {
  const [rawData, setRawData] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedOrigin, setSelectedOrigin] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");
  const [sortDir, setSortDir] = useState("asc"); // asc = low DOH first (critical)
  const [expandedRow, setExpandedRow] = useState(null);

  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/doh", { cache: "no-store" });
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setRawData(json.data || []);
      setMeta(json.meta || null);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  // Filtered + sorted data
  const filtered = useMemo(() => {
    let d = [...rawData];

    if (selectedOrigin !== "All") d = d.filter(r => r.origin === selectedOrigin);
    if (selectedStatus !== "All") d = d.filter(r => r.status === selectedStatus);
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      d = d.filter(r =>
        r.itemName?.toLowerCase().includes(q) ||
        r.itemCode?.toLowerCase().includes(q) ||
        r.itemGroup?.toLowerCase().includes(q)
      );
    }

    d.sort((a, b) => {
      const aNull = a.fgDoh === null;
      const bNull = b.fgDoh === null;
      if (aNull && bNull) return 0;
      if (aNull) return sortDir === "asc" ? 1 : -1;
      if (bNull) return sortDir === "asc" ? -1 : 1;
      return sortDir === "asc" ? a.fgDoh - b.fgDoh : b.fgDoh - a.fgDoh;
    });

    return d;
  }, [rawData, selectedOrigin, selectedStatus, searchTerm, sortDir]);

  const summary = useMemo(() => {
    const counts = {};
    rawData.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });
    return counts;
  }, [rawData]);

  const origins = useMemo(() => meta?.origins || [...new Set(rawData.map(r => r.origin))].sort(), [meta, rawData]);

  const fmt = (n, d = 1) => n == null ? "—" : Number(n).toLocaleString("en-IN", { maximumFractionDigits: d });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0c10", padding: "0 0 40px" }}>

      {/* Header */}
      <div style={{
        background: "rgba(15,19,24,0.95)", borderBottom: "1px solid rgba(255,255,255,0.07)",
        padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(12px)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #3b82f6, #1d4ed8)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, boxShadow: "0 0 20px rgba(59,130,246,0.3)"
          }}>📦</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em", lineHeight: 1.3 }}>FG DOH Dashboard</div>
            <div style={{ fontSize: 12, color: "#5a6474", lineHeight: 1.4 }}>Finished Goods Days on Hand · Farmley</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {meta?._mock && (
            <span style={{ fontSize: 11, background: "rgba(202,138,4,0.15)", color: "#ca8a04", padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(202,138,4,0.3)" }}>
              Demo Mode
            </span>
          )}
          {lastRefresh && (
            <span style={{ fontSize: 12, color: "#5a6474" }}>
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); fetchData(); }}
            style={{
              background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)",
              color: "#3b82f6", padding: "6px 14px", borderRadius: 8,
              cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
              transition: "all 0.2s"
            }}
          >
            ↺ Refresh
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px 28px 0" }}>

        {/* Summary Cards */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard label="Total Items" value={rawData.length} sub="in Inhand" />
          <StatCard label="Critical" value={summary["Critical"] || 0} sub="DOH ≤ 3 days" color="#dc2626" />
          <StatCard label="Stockout" value={summary["Stockout"] || 0} sub="0 inventory" color="#991b1b" />
          <StatCard label="Low" value={summary["Low"] || 0} sub="DOH 4–7 days" color="#ea580c" />
          <StatCard label="Watch" value={summary["Watch"] || 0} sub="DOH 8–15 days" color="#ca8a04" />
          <StatCard label="Healthy" value={summary["Healthy"] || 0} sub="DOH 16–30 days" color="#16a34a" />
          <StatCard label="Overstocked" value={summary["Overstocked"] || 0} sub="DOH > 30 days" color="#2563eb" />
          <StatCard label="Dead Stock" value={(summary["Dead Stock"] || 0) + (summary["No Recent Demand"] || 0)} sub="No demand signal" color="#4b5563" />
        </div>

        {/* Controls */}
        <div style={{
          background: "rgba(15,19,24,0.8)", border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 12, padding: "14px 18px", marginBottom: 16,
          display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center"
        }}>
          {/* Search */}
          <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#5a6474", fontSize: 14 }}>🔍</span>
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search item name, code, group…"
              style={{
                width: "100%", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.09)", borderRadius: 8,
                color: "#e8eaf0", padding: "8px 12px 8px 32px", fontSize: 13,
                fontFamily: "'DM Sans', sans-serif", outline: "none"
              }}
            />
          </div>

          {/* Origin Filter */}
          <select
            value={selectedOrigin}
            onChange={e => setSelectedOrigin(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 8, color: "#e8eaf0", padding: "8px 12px", fontSize: 13,
              fontFamily: "'DM Sans', sans-serif", outline: "none", cursor: "pointer"
            }}
          >
            <option value="All">All Origins</option>
            {origins.map(o => <option key={o} value={o}>{o}</option>)}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value)}
            style={{
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)",
              borderRadius: 8, color: "#e8eaf0", padding: "8px 12px", fontSize: 13,
              fontFamily: "'DM Sans', sans-serif", outline: "none", cursor: "pointer"
            }}
          >
            <option value="All">All Statuses</option>
            {Object.keys(STATUS_CONFIG).map(s => (
              <option key={s} value={s}>{STATUS_CONFIG[s].emoji} {s}</option>
            ))}
          </select>

          {/* Sort Toggle */}
          <button
            onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
            style={{
              background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)",
              color: "#60a5fa", padding: "8px 14px", borderRadius: 8,
              cursor: "pointer", fontSize: 12, fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 6
            }}
          >
            {sortDir === "asc" ? "↑ Critical First" : "↓ Healthy First"}
          </button>

          <span style={{ color: "#5a6474", fontSize: 12, marginLeft: "auto" }}>
            {filtered.length} of {rawData.length} items
          </span>
        </div>

        {/* DOH Legend */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <div
              key={k}
              onClick={() => setSelectedStatus(selectedStatus === k ? "All" : k)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 20,
                background: selectedStatus === k ? v.bg : "rgba(255,255,255,0.02)",
                border: `1px solid ${selectedStatus === k ? v.border : "rgba(255,255,255,0.07)"}`,
                cursor: "pointer", fontSize: 12, color: selectedStatus === k ? v.color : "#8b95a5",
                transition: "all 0.15s"
              }}
            >
              {v.emoji} {k} <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>({summary[k] || 0})</span>
            </div>
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <Spinner />
        ) : error ? (
          <div style={{
            background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.3)",
            borderRadius: 12, padding: 24, color: "#fca5a5", textAlign: "center"
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
            <div style={{ fontWeight: 600 }}>Error loading data</div>
            <div style={{ fontSize: 12, marginTop: 4, color: "#9b7878" }}>{error}</div>
          </div>
        ) : (
          <div style={{
            background: "rgba(15,19,24,0.8)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14, overflow: "hidden"
          }}>
            {/* Table Header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "2.5fr 90px 132px 1fr 110px 100px 100px 80px 120px",
              gap: 0, padding: "12px 18px",
              background: "rgba(255,255,255,0.02)",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              fontSize: 12, fontWeight: 600, color: "#5a6474",
              letterSpacing: "0.06em", textTransform: "uppercase"
            }}>
              <div>Item</div>
              <div>Origin</div>
              <div>Status</div>
              <div>DOH (days)</div>
              <div style={{ textAlign: "right" }}>Inhand (KG)</div>
              <div style={{ textAlign: "right" }}>Avg Demand</div>
              <div style={{ textAlign: "right" }}>SO Qty (KG)</div>
              <div style={{ textAlign: "right" }}>SO Days</div>
              <div style={{ textAlign: "right" }}>Value (₹)</div>
            </div>

            {/* Table Rows */}
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#5a6474" }}>
                No items match your filters
              </div>
            ) : (
              filtered.map((row, i) => {
                const cfg = STATUS_CONFIG[row.status] || STATUS_CONFIG["Dead Stock"];
                const isExpanded = expandedRow === i;
                return (
                  <div key={`${row.itemCode}-${row.origin}`}>
                    <div
                      onClick={() => setExpandedRow(isExpanded ? null : i)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "2.5fr 90px 132px 1fr 110px 100px 100px 80px 120px",
                        gap: 0, padding: "13px 18px",
                        borderBottom: "1px solid rgba(255,255,255,0.04)",
                        borderLeft: `3px solid ${cfg.color}`,
                        background: isExpanded ? "rgba(255,255,255,0.04)" : (i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)"),
                        cursor: "pointer", transition: "background 0.15s",
                        alignItems: "center"
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
                      onMouseLeave={e => e.currentTarget.style.background = isExpanded ? "rgba(255,255,255,0.04)" : (i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)")}
                    >
                      {/* Item Name */}
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: "#e8eaf0", lineHeight: 1.4 }}>
                          {row.itemName}
                        </div>
                        <div style={{ fontSize: 12, color: "#5a6474", marginTop: 3, fontFamily: "'DM Mono', monospace" }}>
                          {row.itemCode}
                          {row.itemGroup && <span style={{ marginLeft: 6, color: "#4b5563" }}>· {row.itemGroup}</span>}
                        </div>
                      </div>

                      {/* Origin */}
                      <div>
                        <span style={{
                          fontSize: 12, padding: "3px 9px", borderRadius: 6,
                          background: "rgba(255,255,255,0.05)", color: "#8b95a5",
                          border: "1px solid rgba(255,255,255,0.08)"
                        }}>{row.origin}</span>
                      </div>

                      {/* Status */}
                      <div><StatusBadge status={row.status} /></div>

                      {/* DOH Bar */}
                      <div><DohBar doh={row.fgDoh} status={row.status} /></div>

                      {/* Inhand Qty */}
                      <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#e8eaf0" }}>
                        {fmt(row.inhandQty)}
                      </div>

                      {/* Avg Daily Demand */}
                      <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#8b95a5" }}>
                        {fmt(row.avgDailyDemand)}<span style={{ fontSize: 11, color: "#5a6474" }}>/d</span>
                      </div>

                      {/* Total SO Qty */}
                      <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#8b95a5" }}>
                        {fmt(row.totalSoQty)}
                      </div>

                      {/* Unique SO Days */}
                      <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#8b95a5" }}>
                        {row.uniqueDays || "—"}
                      </div>

                      {/* Value */}
                      <div style={{ textAlign: "right", fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#8b95a5" }}>
                        {row.value ? `₹${fmt(row.value, 0)}` : "—"}
                      </div>
                    </div>

                    {/* Expanded Row */}
                    {isExpanded && (
                      <div style={{
                        padding: "14px 20px 14px 36px",
                        background: "rgba(59,130,246,0.04)",
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        borderLeft: `3px solid ${cfg.color}`,
                        display: "flex", gap: 32, flexWrap: "wrap"
                      }}>
                        <Detail label="Warehouse" value={row.warehouse || "—"} />
                        <Detail label="Stock Age (days)" value={fmt(row.age)} />
                        <Detail label="Inhand Stock (KG)" value={fmt(row.inhandQty)} />
                        <Detail label="Avg Daily Demand (KG/day)" value={fmt(row.avgDailyDemand, 2)} />
                        <Detail label="Total SO Qty (KG)" value={fmt(row.totalSoQty)} />
                        <Detail label="Unique SO Days" value={row.uniqueDays || "—"} />
                        <Detail label="FG DOH" value={row.fgDoh !== null ? `${row.fgDoh} days` : "—"} highlight />
                        <Detail label="Has Recent Demand (30d)" value={row.hasRecentDemand ? "✅ Yes" : "❌ No"} />
                        <Detail label="Inventory Value" value={row.value ? `₹${fmt(row.value, 0)}` : "—"} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#4b5563" }}>
            FG DOH = Inhand Stock (KG) ÷ Avg Daily Demand · Avg Daily Demand = Total SO KG ÷ Unique SO Days
          </div>
          <div style={{ fontSize: 12, color: "#4b5563" }}>
            Auto-refreshes every 5 minutes · {meta?.generatedAt ? `Data as of ${new Date(meta.generatedAt).toLocaleString()}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, highlight }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#5a6474", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3, lineHeight: 1.4 }}>{label}</div>
      <div style={{ fontSize: 14, fontFamily: "'DM Mono', monospace", fontWeight: highlight ? 700 : 400, color: highlight ? "#60a5fa" : "#c9d1db", lineHeight: 1.4 }}>
        {value}
      </div>
    </div>
  );
}
