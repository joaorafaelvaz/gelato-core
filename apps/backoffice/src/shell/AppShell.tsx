import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { ROUTES, type Route } from '../router'

export function AppShell({ route, navigate, onLogout, children }: {
  route: Route
  navigate: (r: Route) => void
  onLogout: () => void
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const pages = ROUTES[route.group] ?? []
  return (
    <div>
      <header className="topbar">
        <span className="brand">{t('common.appName')}</span>
        <nav className="groups">
          {Object.entries(ROUTES).map(([g, gPages]) => (
            <button
              key={g}
              className={g === route.group ? 'group-tab active' : 'group-tab'}
              onClick={() => navigate({ group: g, page: gPages[0] ?? 'dashboard' })}
            >
              {t(`backoffice.nav.${g}`)}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
          <button onClick={onLogout}>{t('backoffice.common.logout')}</button>
        </div>
      </header>
      {pages.length > 1 && (
        <nav className="subtabs">
          {pages.map((p) => (
            <button
              key={p}
              className={p === route.page ? 'subtab active' : 'subtab'}
              onClick={() => navigate({ group: route.group, page: p })}
            >
              {t(`backoffice.page.${p}`)}
            </button>
          ))}
        </nav>
      )}
      <main className="content">
        <h1>{t(`backoffice.page.${route.page}`)}</h1>
        {children}
      </main>
    </div>
  )
}
