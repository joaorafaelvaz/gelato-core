import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function VouchersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    code: '',
    type: 'FIXED_AMOUNT',
    value: '',
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: '',
    maxUses: '',
  });

  const { data: vouchers, isLoading } = useQuery({
    queryKey: ['vouchers'],
    queryFn: async () => {
      const { data } = await api.get('/vouchers');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const body: any = {
        tenantId: user?.tenantId,
        code: payload.code,
        type: payload.type,
        value: payload.value,
        validFrom: payload.validFrom,
      };
      if (payload.validTo) body.validTo = payload.validTo;
      if (payload.maxUses) body.maxUses = parseInt(payload.maxUses, 10);
      const { data } = await api.post('/vouchers', body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vouchers'] });
      setShowForm(false);
      setForm({ code: '', type: 'FIXED_AMOUNT', value: '', validFrom: new Date().toISOString().slice(0, 10), validTo: '', maxUses: '' });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/vouchers/${id}/deactivate`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vouchers'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Vouchers</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Voucher'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Code</label>
              <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="w-full border px-3 py-2 rounded font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full border px-3 py-2 rounded">
                <option value="FIXED_AMOUNT">Fixed Amount (€)</option>
                <option value="PERCENTAGE">Percentage (%)</option>
                <option value="PRODUCT">Product</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Value</label>
              <input type="number" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Uses</label>
              <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} className="w-full border px-3 py-2 rounded" placeholder="Unlimited" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valid From</label>
              <input type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Valid To</label>
              <input type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
          </div>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.code || !form.value || createMutation.isPending}
            className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving...' : 'Create'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Value</th>
              <th className="px-4 py-2">Used / Max</th>
              <th className="px-4 py-2">Valid</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-400">Loading...</td></tr>}
            {vouchers?.map((v: any) => (
              <tr key={v.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-mono font-bold">{v.code}</td>
                <td className="px-4 py-2">{v.type}</td>
                <td className="px-4 py-2">{v.value}</td>
                <td className="px-4 py-2">{v.usedCount} / {v.maxUses ?? '∞'}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(v.validFrom).toLocaleDateString()} → {v.validTo ? new Date(v.validTo).toLocaleDateString() : '∞'}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${v.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {v.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {v.isActive && (
                    <button onClick={() => deactivateMutation.mutate(v.id)} className="text-red-600 text-xs hover:underline">
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {vouchers?.length === 0 && <tr><td colSpan={7} className="px-4 py-4 text-center text-gray-400">No vouchers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}