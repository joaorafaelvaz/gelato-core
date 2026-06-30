import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

export function LoyaltyPage() {
  const queryClient = useQueryClient();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['loyalty-accounts'],
    queryFn: async () => {
      const { data } = await api.get('/loyalty');
      return data;
    },
  });

  const awardMutation = useMutation({
    mutationFn: async ({ customerId, points, reason }: { customerId: string; points: number; reason: string }) => {
      await api.post('/loyalty/award', { customerId, points, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-accounts'] });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: async ({ customerId, points, reason }: { customerId: string; points: number; reason: string }) => {
      await api.post('/loyalty/redeem', { customerId, points, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-accounts'] });
    },
  });

  function handleAward(customerId: string) {
    const input = prompt(`Award points to customer ${customerId.slice(0, 8)}...:
Points:`, '10');
    if (!input) return;
    const points = parseInt(input, 10);
    if (isNaN(points) || points <= 0) return;
    awardMutation.mutate({ customerId, points, reason: 'Manual award' });
  }

  function handleRedeem(customerId: string) {
    const input = prompt(`Redeem points from customer ${customerId.slice(0, 8)}...:
Points:`, '10');
    if (!input) return;
    const points = parseInt(input, 10);
    if (isNaN(points) || points <= 0) return;
    redeemMutation.mutate({ customerId, points, reason: 'Manual redemption' });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Loyalty Program</h1>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2">Contact</th>
              <th className="px-4 py-2 text-right">Points</th>
              <th className="px-4 py-2 text-right">Stamps</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-gray-400">Loading...</td>
              </tr>
            )}
            {accounts?.map((a: any) => (
              <tr key={a.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2 font-medium">{a.customer?.name ?? '-'}</td>
                <td className="px-4 py-2 text-gray-500">
                  {a.customer?.contact?.email ?? '-'}
                </td>
                <td className="px-4 py-2 text-right font-bold text-blue-600">{a.points}</td>
                <td className="px-4 py-2 text-right">{a.stamps}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => handleAward(a.customerId)}
                    className="text-green-600 text-xs hover:underline mr-3"
                  >
                    + Award
                  </button>
                  <button
                    onClick={() => handleRedeem(a.customerId)}
                    className="text-red-600 text-xs hover:underline"
                  >
                    Redeem
                  </button>
                </td>
              </tr>
            ))}
            {accounts?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-center text-gray-400">
                  No loyalty accounts yet. Create a customer first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}