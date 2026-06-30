import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['tenant-settings'],
    queryFn: async () => {
      const { data } = await api.get('/admin/settings');
      return data;
    },
  });

  const [form, setForm] = useState<Record<string, any>>({});

  // Sync form when settings load
  if (settings && Object.keys(form).length === 0 && !isLoading) {
    setForm({
      defaultMwstImHaus: settings.defaultMwstImHaus ?? '7.00',
      defaultMwstAusserHaus: settings.defaultMwstAusserHaus ?? '19.00',
      currency: settings.currency ?? 'EUR',
      language: settings.language ?? 'de',
      loyaltyPointsPerEuro: settings.loyaltyPointsPerEuro ?? 10,
      receiptFooter: settings.receiptFooter ?? 'Danke für Ihren Besuch!',
    });
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const { data } = await api.post('/admin/settings', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
    },
  });

  if (isLoading) return <div className="text-gray-400">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <div className="bg-white rounded-lg shadow p-6 max-w-2xl">
        <h2 className="font-semibold mb-4">Tenant Configuration</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Default MwSt Im Haus (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.defaultMwstImHaus ?? ''}
              onChange={(e) => setForm({ ...form, defaultMwstImHaus: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default MwSt Außer Haus (%)</label>
            <input
              type="number"
              step="0.01"
              value={form.defaultMwstAusserHaus ?? ''}
              onChange={(e) => setForm({ ...form, defaultMwstAusserHaus: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Currency</label>
            <select
              value={form.currency ?? 'EUR'}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            >
              <option value="EUR">EUR (€)</option>
              <option value="BRL">BRL (R$)</option>
              <option value="USD">USD ($)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Language</label>
            <select
              value={form.language ?? 'de'}
              onChange={(e) => setForm({ ...form, language: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
              <option value="pt">Português</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Loyalty Points per Euro</label>
            <input
              type="number"
              value={form.loyaltyPointsPerEuro ?? ''}
              onChange={(e) => setForm({ ...form, loyaltyPointsPerEuro: parseInt(e.target.value, 10) || 10 })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium mb-1">Receipt Footer</label>
            <input
              type="text"
              value={form.receiptFooter ?? ''}
              onChange={(e) => setForm({ ...form, receiptFooter: e.target.value })}
              className="w-full border px-3 py-2 rounded"
            />
          </div>
        </div>

        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="mt-6 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
        {saveMutation.isSuccess && (
          <span className="ml-4 text-green-600 text-sm">Saved!</span>
        )}
      </div>
    </div>
  );
}