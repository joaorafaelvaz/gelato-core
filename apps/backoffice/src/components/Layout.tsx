import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';

export function Layout() {
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const links = [
    { to: '/', label: t('navigation.dashboard') },
    { to: '/tenants', label: t('navigation.tenants') },
    { to: '/branches', label: t('navigation.branches') },
    { to: '/kassen', label: t('navigation.kassen') },
    { to: '/users', label: t('navigation.users') },
    { to: '/products', label: t('navigation.products') },
    { to: '/ingredients', label: t('navigation.stock') },
    { to: '/stock', label: t('navigation.stock') },
    { to: '/fiscal', label: t('navigation.fiscal') },
    { to: '/tse', label: t('navigation.tse') },
    { to: '/sales', label: t('navigation.sales') },
    { to: '/customers', label: t('navigation.customers') },
    { to: '/loyalty', label: t('navigation.loyalty') },
    { to: '/vouchers', label: t('navigation.vouchers') },
    { to: '/promotions', label: t('navigation.promotions') },
    { to: '/campaigns', label: t('navigation.campaigns') },
    { to: '/audit', label: t('navigation.audit') },
    { to: '/settings', label: t('navigation.settings') },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-slate-900 text-white">
        <div className="p-4 border-b border-slate-700">
          <h1 className="text-lg font-bold">gelato-core</h1>
          <p className="text-xs text-slate-400">{user.tenantSlug}</p>
        </div>
        <nav className="p-4 space-y-2">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="block px-3 py-2 rounded hover:bg-slate-800"
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-4 border-t border-slate-700">
          <div className="mb-2 text-sm">{user.name}</div>
          <div className="flex gap-2 mb-2">
            {(['de', 'en', 'pt'] as const).map((lng) => (
              <button
                key={lng}
                onClick={() => i18n.changeLanguage(lng)}
                className={`text-xs px-2 py-1 rounded ${i18n.language === lng ? 'bg-slate-700' : 'hover:bg-slate-800'}`}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={logout}
            className="text-sm text-slate-300 hover:text-white"
          >
            {t('common.logout')}
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
