import { Mochi } from 'mochi-framework';
import type { MochiRouteValue } from 'mochi-framework';

const TOP_PRODUCTS = [
  { name: 'Mochi Pro Subscription', sku: 'MOCH-PRO', sales: 1284, revenue: 38_400 },
  { name: 'Daifuku Tee — Sakura', sku: 'TEE-SKR-01', sales: 612, revenue: 15_300 },
  { name: 'Strawberry Plush', sku: 'PLSH-STR', sales: 478, revenue: 9_560 },
  { name: 'Sticker Pack v3', sku: 'STK-V3', sales: 1031, revenue: 5_155 },
  { name: 'Hoodie — Matcha', sku: 'HD-MTC', sales: 213, revenue: 12_780 },
];

// Single shared price across all clients — demo simplification.
let stockPrice = 42.3;

function nextStockPrice(): { price: number; change: number; timestamp: string } {
  const drift = (Math.random() - 0.48) * 0.45;
  stockPrice = Math.max(1, stockPrice + drift);
  return {
    price: Number(stockPrice.toFixed(2)),
    change: Number(drift.toFixed(2)),
    timestamp: new Date().toISOString(),
  };
}

export const routes: Record<string, MochiRouteValue> = {
  '/admin': Mochi.page('./src/admin/AdminDashboard.svelte'),

  '/sse/admin/stock': Mochi.sse((stream) => {
    stream.send(JSON.stringify(nextStockPrice()));
    const interval = setInterval(() => {
      stream.send(JSON.stringify(nextStockPrice()));
    }, 1500);
    stream.onClose(() => clearInterval(interval));
  }),

  '/api/admin/products': Mochi.api(async () => {
    await Bun.sleep(1500 + Math.random() * 1000);
    return Response.json({
      products: TOP_PRODUCTS,
      generatedAt: new Date().toISOString(),
    });
  }),
};
