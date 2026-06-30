import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface Product {
  id: string;
  name: string;
  type: string;
  basePrice: string | null;
  mwstImHaus: string;
  mwstAusserHaus: string;
  isActive: boolean;
}

export function ProductsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'VENDAVEL',
    basePrice: '',
    mwstImHaus: '7.00',
    mwstAusserHaus: '19.00',
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await api.get('/products');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data } = await api.post('/products', {
        tenantId: user?.tenantId,
        name: payload.name,
        type: payload.type,
        basePrice: payload.basePrice || undefined,
        mwstImHaus: payload.mwstImHaus,
        mwstAusserHaus: payload.mwstAusserHaus,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowForm(false);
      setForm({ name: '', type: 'VENDAVEL', basePrice: '', mwstImHaus: '7.00', mwstAusserHaus: '19.00' });
    },
  });

  const fmt = (v: string | null) => (v ? parseFloat(v).toFixed(2) : '-');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">{t('navigation.products')}</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Product'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <h2 className="font-semibold mb-4">New Product</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="VENDAVEL">Vendável</option>
                <option value="INSUMO">Insumo</option>
                <option value="SEMI_ACABADO">Semi-acabado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Base Price (€)</label>
              <input
                type="number"
                step="0.01"
                value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                className="w-full border px-3 py-2 rounded"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <div className="text-sm text-gray-400">—</div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">MwSt Im Haus (%)</label>
              <input
                type="number"
                step="0.01"
                value={form.mwstImHaus}
                onChange={(e) => setForm({ ...form, mwstImHaus: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">MwSt Außer Haus (%)</label>
              <input
                type="number"
                step="0.01"
                value={form.mwstAusserHaus}
                onChange={(e) => setForm({ ...form, mwstAusserHaus: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.name || createMutation.isPending}
              className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
            >
              {createMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            {createMutation.isError && (
              <span className="text-red-600 text-sm self-center">
                Error: {(createMutation.error as any)?.response?.data?.message ?? 'Failed'}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">MwSt Im Haus</th>
              <th className="px-4 py-2">MwSt Außer Haus</th>
              <th className="px-4 py-2">Base Price</th>
              <th className="px-4 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {products?.map((p: Product) => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-gray-500">{p.type}</td>
                <td className="px-4 py-2">{p.mwstImHaus}%</td>
                <td className="px-4 py-2">{p.mwstAusserHaus}%</td>
                <td className="px-4 py-2">{fmt(p.basePrice)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
            {products?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-gray-400">
                  No products yet. Click "New Product" to create one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}