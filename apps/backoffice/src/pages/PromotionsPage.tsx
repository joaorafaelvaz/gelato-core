import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function PromotionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    rule: '{"type":"buy_x_get_y","buyQty":5,"getQty":1}',
    activeFrom: new Date().toISOString().slice(0, 10),
    activeTo: '',
  });

  const { data: promotions, isLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: async () => {
      const { data } = await api.get('/promotions');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      let ruleObj: any;
      try {
        ruleObj = JSON.parse(payload.rule);
      } catch {
        throw new Error('Invalid JSON rule');
      }
      const body: any = {
        tenantId: user?.tenantId,
        name: payload.name,
        rule: ruleObj,
        activeFrom: payload.activeFrom,
      };
      if (payload.activeTo) body.activeTo = payload.activeTo;
      const { data } = await api.post('/promotions', body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setShowForm(false);
      setForm({ name: '', rule: '{"type":"buy_x_get_y","buyQty":5,"getQty":1}', activeFrom: new Date().toISOString().slice(0, 10), activeTo: '' });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      await api.post(`/promotions/${id}/${active ? 'activate' : 'deactivate'}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotions'] }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Promotions</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Promotion'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Active From</label>
              <input type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Active To</label>
              <input type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Rule (JSON)</label>
              <textarea value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value })} className="w-full border px-3 py-2 rounded font-mono text-sm h-24" />
            </div>
          </div>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name || createMutation.isPending}
            className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving...' : 'Create'}
          </button>
          {createMutation.isError && (
            <span className="ml-4 text-red-600 text-sm">Error: {(createMutation.error as any)?.message ?? 'Failed'}</span>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Rule</th>
              <th className="px-4 py-2">Active Period</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">Loading...</td></tr>}
            {promotions?.map((p: any) => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-gray-500 max-w-xs truncate">
                  {JSON.stringify(p.rule)}
                </td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {new Date(p.activeFrom).toLocaleDateString()} → {p.activeTo ? new Date(p.activeTo).toLocaleDateString() : '∞'}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => toggleMutation.mutate({ id: p.id, active: !p.isActive })}
                    className="text-blue-600 text-xs hover:underline"
                  >
                    {p.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
            {promotions?.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">No promotions yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}