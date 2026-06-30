import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function StockPage() {
  const [branchId, setBranchId] = useState('');
  const { data: stock, isLoading } = useQuery({
    queryKey: ['stock', branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const { data } = await api.get(`/stock/items/${branchId}`);
      return data;
    },
    enabled: !!branchId,
  });

  const { data: alerts } = useQuery({
    queryKey: ['stock-alerts', branchId],
    queryFn: async () => {
      if (!branchId) return [];
      const { data } = await api.get(`/stock/alerts/${branchId}`);
      return data;
    },
    enabled: !!branchId,
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Stock / Lager</h1>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Branch ID</label>
        <input
          type="text"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className="border px-3 py-2 rounded"
          placeholder="Enter branch ID"
        />
      </div>

      {alerts && alerts.length > 0 && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-4">
          <h2 className="font-semibold text-red-700 mb-2">Stock Alerts</h2>
          <ul className="text-sm">
            {alerts.map((a: any) => (
              <li key={a.stockItemId} className="text-red-700">
                {a.ingredientName}: {a.qtyBase} {'<'} {a.mindestbestand} ({a.severity})
              </li>
            ))}
          </ul>
        </div>
      )}

      {isLoading && <div>Loading stock...</div>}

      {stock && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-4 py-2">Ingredient</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Mindestbestand</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((s: any) => (
                <tr key={s.id} className="border-t">
                  <td className="px-4 py-2">{s.ingredient?.name}</td>
                  <td className="px-4 py-2">{s.qtyBase}</td>
                  <td className="px-4 py-2">{s.mindestbestand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
