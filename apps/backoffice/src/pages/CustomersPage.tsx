import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function CustomersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: async () => {
      const { data } = await api.get('/customers', {
        params: search ? { search } : {},
      });
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data } = await api.post('/customers', {
        tenantId: user?.tenantId,
        name: payload.name,
        contact: { email: payload.email, phone: payload.phone },
        notes: payload.notes || undefined,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      setForm({ name: '', email: '', phone: '', notes: '' });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Customers</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Customer'}
        </button>
      </div>

      <input
        type="text"
        placeholder="Search customers..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full mb-4 border px-3 py-2 rounded"
      />

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
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
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2">Loyalty Points</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-gray-400">Loading...</td>
              </tr>
            )}
            {customers?.map((c: any) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{c.name ?? '-'}</td>
                <td className="px-4 py-2 text-gray-500">
                  {c.contact?.email ?? '-'}
                  {c.contact?.phone && ` · ${c.contact.phone}`}
                </td>
                <td className="px-4 py-2">{c.loyaltyAccount?.points ?? 0}</td>
                <td className="px-4 py-2 text-gray-500">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {customers?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-4 text-center text-gray-400">
                  No customers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}