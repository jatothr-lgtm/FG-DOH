export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const url = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

  if (!url || url.includes("YOUR_DEPLOYMENT_ID")) {
    // Return mock data for development/demo
    return Response.json(getMockData());
  }

  try {
    const res = await fetch(`${url}?action=getData`, {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 0 }
    });

    if (!res.ok) throw new Error(`Apps Script returned ${res.status}`);
    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    console.error("Apps Script fetch error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}

function getMockData() {
  const statuses = ["Critical", "Critical", "Low", "Watch", "Healthy", "Overstocked", "Dead Stock", "No Recent Demand", "Stockout"];
  const origins = ["Indore", "UD Foods", "Purnea", "Rebela", "Udupi"];
  const groups = ["Munchies", "Trail Mixes", "Healthy Desserts", "Dry Fruits", "Seeds", "Dates"];
  const items = [
    ["Almonds_1-1748", "Premium California Almonds Farmley 500g"],
    ["Almonds_1-194", "Popular California Almonds Farmley 250g"],
    ["Cashewnut_3-1736", "Premium W320 Cashew Farmley 250g"],
    ["Makhana_7-2661", "Andhra Masala Munchies Farmley 33g"],
    ["Dates_15-30111", "Apple Pie Date Bite Farmley 20g"],
    ["Seeds_11-2542", "Pumpkin Seeds Farmley Standee 200g"],
    ["Apricot_2-2540", "Premium Turkish Apricot Farmley 200g"],
    ["DryFruit_5-2543", "Premium Mixed Dry Fruit Farmley 500g"],
    ["Walnut_8-1890", "Premium Walnut Kernels Farmley 250g"],
    ["Pistachio_9-2211", "Premium Roasted Pistachio Farmley 200g"],
    ["FigDates_12-3001", "Anjeer Farmley Standee 200g"],
    ["Raisin_10-1755", "Premium Golden Raisin Farmley 500g"],
  ];

  const data = items.flatMap(([code, name]) =>
    origins.slice(0, 2 + Math.floor(Math.random() * 3)).map(origin => {
      const inhandQty = Math.round(Math.random() * 2000 * 10) / 10;
      const avgDemand = Math.round(Math.random() * 300 * 10) / 10;
      const fgDoh = avgDemand > 0 ? Math.round((inhandQty / avgDemand) * 100) / 100 : null;
      let status = "Dead Stock";
      if (fgDoh !== null) {
        if (fgDoh === 0) status = "Stockout";
        else if (fgDoh <= 3) status = "Critical";
        else if (fgDoh <= 7) status = "Low";
        else if (fgDoh <= 15) status = "Watch";
        else if (fgDoh <= 30) status = "Healthy";
        else status = "Overstocked";
      }
      return {
        itemCode: code,
        itemName: name,
        origin,
        itemGroup: groups[Math.floor(Math.random() * groups.length)],
        warehouse: `RPC ${origin} Finished Goods`,
        value: Math.round(Math.random() * 50000),
        age: Math.round(Math.random() * 30 * 10) / 10,
        inhandQty,
        totalSoQty: Math.round(Math.random() * 10000),
        uniqueDays: Math.floor(Math.random() * 20) + 1,
        avgDailyDemand: avgDemand,
        fgDoh,
        status,
        hasRecentDemand: Math.random() > 0.2
      };
    })
  );

  return {
    data,
    meta: {
      totalItems: data.length,
      generatedAt: new Date().toISOString(),
      origins,
      itemGroups: groups,
      _cached: false,
      _mock: true
    }
  };
}
