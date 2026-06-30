import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { login } from '../lib/api';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuth } = useAuth();
  const [email, setEmail] = useState('admin@demo.de');
  const [password, setPassword] = useState('admin123');
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login({ email, password, tenantSlug });
      setAuth(res);
      navigate('/');
    } catch {
      setError(t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleSubmit}
        className="bg-white p-8 rounded-lg shadow-md w-full max-w-md"
      >
        <h1 className="text-2xl font-bold mb-6 text-center">{('gelato-core')}</h1>
        <h2 className="text-lg font-semibold mb-4">{t('login.title')}</h2>

        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

        <label className="block mb-2 text-sm font-medium">{t('login.tenantSlug')}</label>
        <input
          type="text"
          value={tenantSlug}
          onChange={(e) => setTenantSlug(e.target.value)}
          className="w-full mb-4 px-3 py-2 border rounded"
          required
        />

        <label className="block mb-2 text-sm font-medium">{t('common.email')}</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 border rounded"
          required
        />

        <label className="block mb-2 text-sm font-medium">{t('common.password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-6 px-3 py-2 border rounded"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-primary text-white py-2 rounded hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('login.submit')}
        </button>
      </form>
    </div>
  );
}
