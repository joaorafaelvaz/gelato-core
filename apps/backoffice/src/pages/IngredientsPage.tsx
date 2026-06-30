import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function IngredientsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', baseUnit: 'L', description: '' });

  const { data: ingredients, isLoading } = useQuery({
    queryKey: ['ingredients'],
    queryFn: async () => {
      const { data } = await api.get('/stock/ingredients');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data } = await api.post('/stock/ingredients', {
        tenantId: user?.tenantId,
        name: payload.name,
        baseUnit: payload.baseUnit,
        description: payload.description || undefined,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingredients'] });
      setShowForm(false);
      setForm({ name: '', baseUnit: 'L', description: '' });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Ingredients / Zutaten</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Ingredient'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <div className="grid grid-cols-3 gap-4">
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
              <label className="block text-sm font-medium mb-1">Base Unit</label>
              <select
                value={form.baseUnit}
                onChange={(e) => setForm({ ...form, baseUnit: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="L">Liter (L)</option>
                <option value="KG">Kilogram (kg)</option>
                <option value="G">Gram (g)</option>
                <option value="PCS">Pieces (pcs)</option>
                <option value="ML">Milliliter (ml)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
          </div>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name || createMutation.isPending}
            className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Base Unit</th>
              <th className="px-4 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-gray-400">
                  Loading...
                </td>
              </tr>
            )}
            {ingredients?.map((i: any) => (
              <tr key={i.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{i.name}</td>
                <td className="px-4 py-2 text-gray-500">{i.baseUnit}</td>
                <td className="px-4 py-2 text-gray-500">{i.description ?? '-'}</td>
              </tr>
            ))}
            {ingredients?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-gray-400">
                  No ingredients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}