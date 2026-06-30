import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function TenantsPage() {
  const { data: tenants, isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data } = await api.get('/tenants');
      return data;
    },
  });

  if (isLoading) return <div>Loading tenants...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Tenants / Mandanten</h1>
      <ul className="space-y-2">
        {tenants?.map((tenant: { id: string; name: string; slug: string }) => (
          <li key={tenant.id} className="p-3 bg-white rounded shadow">
            <strong>{tenant.name}</strong> — {tenant.slug}
          </li>
        ))}
      </ul>
    </div>
  );
}
