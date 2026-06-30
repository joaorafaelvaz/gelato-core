import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function SalesDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics-dashboard', 30],
    queryFn: async () => {
      const { data } = await api.get('/analytics/dashboard?days=30');
      return data;
    },
  });

  const fmt = (n: number) => (n ? n.toFixed(2) : '0.00');

  // Simple bar chart from salesByDay
  const maxGross = data?.salesByDay?.reduce(
    (m: number, d: any) => Math.max(m, d.gross),
    0,
  ) ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Sales Dashboard</h1>

      {isLoading && <div className="text-gray-400">Loading...</div>}

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Orders (30d)</div>
              <div className="text-2xl font-bold mt-1">{data.summary.orderCount}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Total Gross</div>
              <div className="text-2xl font-bold mt-1">{fmt(data.summary.totalGross)} €</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Total MwSt</div>
              <div className="text-2xl font-bold mt-1">{fmt(data.summary.totalMwst)} €</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Avg Order</div>
              <div className="text-2xl font-bold mt-1">{fmt(data.summary.avgOrderValue)} €</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Sales by day chart */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-4">Sales by Day</h2>
              <div className="space-y-1">
                {data.salesByDay?.map((d: any) => (
                  <div key={d.day} className="flex items-center gap-2 text-xs">
                    <div className="w-20 text-gray-500">{d.day.slice(5)}</div>
                    <div className="flex-1 bg-gray-100 rounded h-5 relative">
                      <div
                        className="bg-blue-500 h-5 rounded"
                        style={{ width: `${(d.gross / maxGross) * 100}%` }}
                      />
                    </div>
                    <div className="w-16 text-right font-semibold">{fmt(d.gross)} €</div>
                  </div>
                ))}
                {data.salesByDay?.length === 0 && (
                  <div className="text-gray-400 text-sm py-4 text-center">No sales in the last 30 days.</div>
                )}
              </div>
            </div>

            {/* Top products */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-semibold mb-4">Top Products</h2>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topProducts?.map((p: any) => (
                    <tr key={p.productId} className="border-t">
                      <td className="px-3 py-2">{p.productName}</td>
                      <td className="px-3 py-2 text-right">{p.qty}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(p.revenue)} €</td>
                    </tr>
                  ))}
                  {data.topProducts?.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-4 text-center text-gray-400">
                        No product sales yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment breakdown */}
          <div className="bg-white rounded-lg shadow p-4 mt-6">
            <h2 className="font-semibold mb-4">Payment Methods</h2>
            <div className="flex gap-8">
              {data.paymentBreakdown?.map((p: any) => (
                <div key={p.method} className="text-center">
                  <div className="text-3xl font-bold">{fmt(p.total)} €</div>
                  <div className="text-sm text-gray-500">{p.method}</div>
                </div>
              ))}
              {data.paymentBreakdown?.length === 0 && (
                <div className="text-gray-400 text-sm">No payments yet.</div>
              )}
            </div>
          </div>

          {/* Sales by hour */}
          {data.salesByHour?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4 mt-6">
              <h2 className="font-semibold mb-4">Sales by Hour</h2>
              <div className="flex gap-1 items-end h-32">
                {Array.from({ length: 24 }, (_, h) => {
                  const entry = data.salesByHour.find((s: any) => s.hour === h);
                  const gross = entry?.gross ?? 0;
                  const maxH = Math.max(...data.salesByHour.map((s: any) => s.gross), 1);
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center justify-end" title={`${h}:00 — ${fmt(gross)} €`}>
                      <div
                        className="w-full bg-blue-400 rounded-t"
                        style={{ height: `${(gross / maxH) * 100}%`, minHeight: gross > 0 ? '2px' : '0' }}
                      />
                      <div className="text-xs text-gray-400 mt-1">{h}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Sales by branch */}
          {data.salesByBranch?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4 mt-6">
              <h2 className="font-semibold mb-4">Sales by Branch</h2>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2">Branch</th>
                    <th className="px-3 py-2 text-right">Orders</th>
                    <th className="px-3 py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.salesByBranch.map((b: any) => (
                    <tr key={b.branchId} className="border-t">
                      <td className="px-3 py-2 font-medium">{b.branchName}</td>
                      <td className="px-3 py-2 text-right">{b.count}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(b.gross)} €</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}