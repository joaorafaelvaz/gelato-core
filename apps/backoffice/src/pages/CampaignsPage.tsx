import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function CampaignsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    channel: 'EMAIL',
    scheduledAt: '',
    subject: '',
    body: '',
    segment: '{"minPoints":0}',
  });
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data } = await api.get('/campaigns');
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      let segmentObj: any;
      try {
        segmentObj = JSON.parse(payload.segment);
      } catch {
        throw new Error('Invalid segment JSON');
      }
      const body: any = {
        tenantId: user?.tenantId,
        name: payload.name,
        channel: payload.channel,
        segment: segmentObj,
        content: { subject: payload.subject, body: payload.body },
      };
      if (payload.scheduledAt) body.scheduledAt = payload.scheduledAt;
      const { data } = await api.post('/campaigns', body);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setShowForm(false);
      setForm({ name: '', channel: 'EMAIL', scheduledAt: '', subject: '', body: '', segment: '{"minPoints":0}' });
      setPreviewCount(null);
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.post(`/campaigns/${id}/status`, { status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const previewSegment = async () => {
    try {
      const segmentObj = JSON.parse(form.segment);
      const { data } = await api.post('/campaigns/segment/preview', { segment: segmentObj });
      setPreviewCount(data.count);
    } catch {
      setPreviewCount(null);
    }
  };

  const statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-600',
    SCHEDULED: 'bg-blue-100 text-blue-700',
    SENT: 'bg-green-100 text-green-700',
    CANCELLED: 'bg-red-100 text-red-700',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm font-semibold"
        >
          {showForm ? 'Cancel' : '+ New Campaign'}
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
              <label className="block text-sm font-medium mb-1">Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="w-full border px-3 py-2 rounded">
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="SMS">SMS</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Schedule (optional)</label>
              <input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subject</label>
              <input type="text" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full border px-3 py-2 rounded" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Body</label>
              <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full border px-3 py-2 rounded h-24" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Segment (JSON)</label>
              <div className="flex gap-2">
                <input type="text" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} className="flex-1 border px-3 py-2 rounded font-mono text-sm" />
                <button onClick={previewSegment} className="bg-gray-200 px-4 py-2 rounded text-sm">
                  Preview
                </button>
              </div>
              {previewCount !== null && (
                <div className="mt-1 text-sm text-gray-500">
                  Segment reaches <b>{previewCount}</b> customers
                </div>
              )}
            </div>
          </div>
          <button
            onClick={() => createMutation.mutate(form)}
            disabled={!form.name || createMutation.isPending}
            className="mt-4 bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 text-sm font-semibold disabled:opacity-50"
          >
            {createMutation.isPending ? 'Saving...' : 'Create Campaign'}
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
              <th className="px-4 py-2">Channel</th>
              <th className="px-4 py-2">Scheduled</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">Loading...</td></tr>}
            {campaigns?.map((c: any) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2">{c.channel}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : '-'}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusColors[c.status] ?? 'bg-gray-100'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {c.status === 'DRAFT' && (
                    <>
                      <button
                        onClick={() => statusMutation.mutate({ id: c.id, status: 'SCHEDULED' })}
                        className="text-blue-600 text-xs hover:underline mr-3"
                      >
                        Schedule
                      </button>
                      <button
                        onClick={() => statusMutation.mutate({ id: c.id, status: 'CANCELLED' })}
                        className="text-red-600 text-xs hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {c.status === 'SCHEDULED' && (
                    <button
                      onClick={() => statusMutation.mutate({ id: c.id, status: 'SENT' })}
                      className="text-green-600 text-xs hover:underline mr-3"
                    >
                      Mark Sent
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns?.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-gray-400">No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}