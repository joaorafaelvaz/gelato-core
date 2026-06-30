import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function FiscalDashboardPage() {
  const queryClient = useQueryClient();
  const [kasseId, setKasseId] = useState('');
  const [businessDay, setBusinessDay] = useState('');

  const xReport = useQuery({
    queryKey: ['x-report', kasseId, businessDay],
    queryFn: async () => {
      const { data } = await api.get(`/reports/x/${kasseId}`, {
        params: businessDay ? { businessDay } : {},
      });
      return data;
    },
    enabled: !!kasseId,
  });

  const zReports = useQuery({
    queryKey: ['z-reports', kasseId],
    queryFn: async () => {
      const { data } = await api.get(`/reports/z/${kasseId}`);
      return data;
    },
    enabled: !!kasseId,
  });

  const zMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/reports/z/${kasseId}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['z-reports', kasseId] });
      queryClient.invalidateQueries({ queryKey: ['x-report', kasseId, businessDay] });
    },
  });

  const exportCsv = async () => {
    if (!kasseId || !businessDay) return;
    const response = await api.get(`/exports/kassenabschluss/${kasseId}`, {
      params: { businessDay },
    });
    const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kassenabschluss_${kasseId}_${businessDay}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const fmt = (n: number) => (n ? n.toFixed(2) : '0.00');

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Fiscal Dashboard</h1>

      <div className="flex gap-4 mb-6">
        <input
          type="text"
          value={kasseId}
          onChange={(e) => setKasseId(e.target.value)}
          placeholder="Kasse ID"
          className="border px-3 py-2 rounded"
        />
        <input
          type="date"
          value={businessDay}
          onChange={(e) => setBusinessDay(e.target.value)}
          className="border px-3 py-2 rounded"
        />
        <button
          onClick={() => zMutation.mutate()}
          disabled={!kasseId || zMutation.isPending}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm font-semibold"
        >
          {zMutation.isPending ? 'Generating...' : 'Generate Z-Report'}
        </button>
        <button
          onClick={exportCsv}
          disabled={!kasseId || !businessDay}
          className="bg-slate-600 text-white px-4 py-2 rounded hover:bg-slate-700 disabled:opacity-50 text-sm font-semibold"
        >
          Export Kassenabschluss
        </button>
      </div>

      {zMutation.data && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded p-4 text-sm">
          Z-Report generated: seqNr {zMutation.data.seqNr}
        </div>
      )}
      {zMutation.isError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded p-4 text-sm text-red-700">
          Error: {(zMutation.error as any)?.response?.data?.message ?? 'Failed'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* X-Report */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">X-Report {xReport.data?.businessDay}</h2>
          {xReport.isLoading && <div className="text-gray-400 text-sm">Loading...</div>}
          {xReport.data && (
            <>
              <div className="grid grid-cols-3 gap-4 text-sm mb-4">
                <div>Orders: {xReport.data.orderCount}</div>
                <div>Stornos: {xReport.data.stornoCount}</div>
                <div>Ausfall: {xReport.data.ausfallCount}</div>
                <div>Gross: {fmt(xReport.data.totalGross)}</div>
                <div>Net: {fmt(xReport.data.totalNet)}</div>
                <div>MwSt: {fmt(xReport.data.totalMwst)}</div>
              </div>
              <h3 className="font-semibold text-sm mb-1">MwSt by rate</h3>
              <ul className="text-sm mb-4">
                {xReport.data.mwstByRate?.map((r: any) => (
                  <li key={r.rate}>
                    {r.rate}% — gross {fmt(r.gross)}, net {fmt(r.net)}, mwst {fmt(r.mwst)}
                  </li>
                ))}
              </ul>
              <h3 className="font-semibold text-sm mb-1">Payments</h3>
              <ul className="text-sm">
                {xReport.data.paymentsByMethod?.map((p: any) => (
                  <li key={p.method}>
                    {p.method}: {fmt(p.amount)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Z-Report history */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">Z-Report History</h2>
          {zReports.isLoading && <div className="text-gray-400 text-sm">Loading...</div>}
          {zReports.data?.length === 0 && (
            <div className="text-gray-400 text-sm">No Z-reports yet.</div>
          )}
          <div className="space-y-2">
            {zReports.data?.map((z: any) => (
              <div key={z.id} className="border rounded p-3 text-sm">
                <div className="flex justify-between">
                  <span className="font-semibold">Seq {z.seqNr}</span>
                  <span className="text-gray-400">
                    {new Date(z.generatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="text-gray-500 mt-1">
                  Business day: {new Date(z.businessDay).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}