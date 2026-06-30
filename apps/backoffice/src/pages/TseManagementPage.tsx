import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function TseManagementPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    kasseId: '',
    provider: 'fiskaly',
    serialNumber: '',
    apiUrl: 'https://kassensichv.fiskaly.com/api/v0',
    apiKey: '',
    apiSecret: '',
    tssId: '',
  });

  const { data: tseClients, isLoading } = useQuery({
    queryKey: ['tse-clients'],
    queryFn: async () => {
      const { data } = await api.get('/admin/tse');
      return data;
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const body: any = {
        kasseId: payload.kasseId,
        provider: payload.provider,
        serialNumber: payload.serialNumber,
      };
      if (payload.apiUrl) body.apiUrl = payload.apiUrl;
      if (payload.apiKey) body.apiKey = payload.apiKey;
      if (payload.apiSecret) body.apiSecret = payload.apiSecret;
      if (payload.tssId) body.tssId = payload.tssId;
      const { data } = await api.post('/admin/tse/register', body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tse-clients'] });
      setShowForm(false);
      setForm({
        kasseId: '',
        provider: 'fiskaly',
        serialNumber: '',
        apiUrl: 'https://kassensichv.fiskaly.com/api/v0',
        apiKey: '',
        apiSecret: '',
        tssId: '',
      });
    },
  });

  const deregisterMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/admin/tse/${id}/deregister`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tse-clients'] });
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">TSE Management</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ Register TSE'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow p-6 mb-4">
          <h2 className="font-semibold mb-4">Register TSE Client</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Kasse ID</label>
              <input
                type="text"
                value={form.kasseId}
                onChange={(e) => setForm({ ...form, kasseId: e.target.value })}
                className="w-full border px-3 py-2 rounded"
                placeholder="UUID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Provider</label>
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              >
                <option value="fiskaly">fiskaly (Cloud)</option>
                <option value="swissbit">Swissbit (Local USB/SD)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Serial Number</label>
              <input
                type="text"
                value={form.serialNumber}
                onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                className="w-full border px-3 py-2 rounded"
              />
            </div>
            {form.provider === 'fiskaly' && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">API URL</label>
                  <input
                    type="text"
                    value={form.apiUrl}
                    onChange={(e) => setForm({ ...form, apiUrl: e.target.value })}
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">API Key</label>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">API Secret</label>
                  <input
                    type="password"
                    value={form.apiSecret}
                    onChange={(e) => setForm({ ...form, apiSecret: e.target.value })}
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">TSS ID</label>
                  <input
                    type="text"
                    value={form.tssId}
                    onChange={(e) => setForm({ ...form, tssId: e.target.value })}
                    className="w-full border px-3 py-2 rounded"
                  />
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => registerMutation.mutate(form)}
            disabled={!form.kasseId || !form.serialNumber || registerMutation.isPending}
            className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
          >
            {registerMutation.isPending ? 'Registering...' : 'Register'}
          </button>
          {registerMutation.isError && (
            <span className="ml-4 text-red-600 text-sm">
              Error: {(registerMutation.error as any)?.response?.data?.message ?? 'Failed'}
            </span>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Provider</th>
              <th className="px-4 py-2">Serial Number</th>
              <th className="px-4 py-2">Kasse</th>
              <th className="px-4 py-2">Registered</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
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
            {tseClients?.map((c: any) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{c.provider}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.serialNumber}</td>
                <td className="px-4 py-2">{c.kasse?.name ?? c.kasseId}</td>
                <td className="px-4 py-2 text-gray-500">
                  {c.registeredAt ? new Date(c.registeredAt).toLocaleDateString() : '-'}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      c.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {c.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {c.isActive && (
                    <button
                      onClick={() => deregisterMutation.mutate(c.id)}
                      disabled={deregisterMutation.isPending}
                      className="text-red-600 text-xs hover:underline"
                    >
                      Deregister
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {tseClients?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-gray-400">
                  No TSE clients registered.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}