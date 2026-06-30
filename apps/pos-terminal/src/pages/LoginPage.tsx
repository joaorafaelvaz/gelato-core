import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePos } from '../contexts/PosContext';
import { login, setTokenHandler } from '../lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setSession } = usePos();
  const [email, setEmail] = useState('admin@demo.de');
  const [password, setPassword] = useState('admin123');
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [kasseId, setKasseId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login({ email, password, tenantSlug });
      setTokenHandler(() => res.accessToken);
      setSession(
        res.accessToken,
        {
          id: res.user.id,
          name: res.user.name,
          email: res.user.email,
          tenantId: res.user.tenantId,
          betriebsstaetteIds: res.user.betriebsstaetteIds,
          permissions: res.user.permissions,
        },
        kasseId || 'local-kasse',
      );
      navigate('/');
    } catch {
      setError(t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-800 p-8 rounded-lg shadow-lg w-full max-w-md"
      >
        <h1 className="text-2xl font-bold mb-6 text-center">{('gelato-core Kasse')}</h1>
        <h2 className="text-lg font-semibold mb-4">{t('login.title')}</h2>

        {error && <div className="mb-4 p-3 bg-red-900 text-red-100 rounded">{error}</div>}

        <label className="block mb-2 text-sm font-medium">{t('login.tenantSlug')}</label>
        <input
          type="text"
          value={tenantSlug}
          onChange={(e) => setTenantSlug(e.target.value)}
          className="w-full mb-4 px-3 py-2 bg-gray-700 rounded border border-gray-600"
          required
        />

        <label className="block mb-2 text-sm font-medium">{t('common.email')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 bg-gray-700 rounded border border-gray-600"
          required
        />

        <label className="block mb-2 text-sm font-medium">{t('common.password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 bg-gray-700 rounded border border-gray-600"
          required
        />

        <label className="block mb-2 text-sm font-medium">Kasse ID</label>
        <input
          type="text"
          value={kasseId}
          onChange={(e) => setKasseId(e.target.value)}
          placeholder="local-kasse"
          className="w-full mb-6 px-3 py-2 bg-gray-700 rounded border border-gray-600"
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white py-3 rounded font-semibold hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
