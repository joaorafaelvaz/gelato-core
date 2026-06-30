import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function AuditLogPage() {
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', action, entity, offset],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (action) params.action = action;
      if (entity) params.entity = entity;
      const { data } = await api.get('/audit', { params });
      return data;
    },
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Audit Log</h1>

      <div className="flex gap-4 mb-4">
        <input
          type="text"
          placeholder="Filter by action (e.g. pos.sale)"
          value={action}
          onChange={(e) => { setAction(e.target.value); setOffset(0); }}
          className="border px-3 py-2 rounded w-48"
        />
        <input
          type="text"
          placeholder="Filter by entity (e.g. order)"
          value={entity}
          onChange={(e) => { setEntity(e.target.value); setOffset(0); }}
          className="border px-3 py-2 rounded w-48"
        />
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Entity</th>
              <th className="px-4 py-2">Entity ID</th>
              <th className="px-4 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-gray-400">Loading...</td>
              </tr>
            )}
            {data?.rows?.map((log: any) => (
              <tr key={log.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 text-gray-500 text-xs">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-2">{log.user?.name ?? '-'}</td>
                <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-2">{log.entity}</td>
                <td className="px-4 py-2 font-mono text-xs">{log.entityId?.slice(0, 8) ?? '-'}</td>
                <td className="px-4 py-2 text-gray-400 text-xs">{log.ipAddress ?? '-'}</td>
              </tr>
            ))}
            {data?.rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-gray-400">
                  No audit entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {data?.total ?? 0} total entries
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="bg-gray-200 px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            ← Prev
          </button>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={(data?.total ?? 0) <= offset + limit}
            className="bg-gray-200 px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}