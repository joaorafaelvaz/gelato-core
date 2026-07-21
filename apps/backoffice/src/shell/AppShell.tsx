import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { ROUTES, type Route } from '../router'
import { IconLogout, IconUser, PageIcon } from '../icons'

export function AppShell({ route, navigate, onLogout, children }: {
  route: Route
  navigate: (r: Route) => void
  onLogout: () => void
  children: ReactNode
}) {
  const { t, i18n } = useTranslation()
  return (
    <div className="bo-app">
      <aside className="bo-sidebar">
        <div className="bo-sidebar-logo">
          <img src="/skyview-logo.png" alt="Skyview" />
          <span className="bo-sidebar-tagline">{t('backoffice.common.tagline')}</span>
        </div>
        <nav className="bo-nav">
          {Object.entries(ROUTES).map(([g, gPages]) => (
            <div key={g} className="bo-nav-group">
              <div className="bo-nav-group-label">{t(`backoffice.nav.${g}`)}</div>
              {gPages.map((p) => (
                <button
                  key={p}
                  className={route.page === p ? 'bo-nav-item active' : 'bo-nav-item'}
                  onClick={() => navigate({ group: g, page: p })}
                >
                  <PageIcon page={p} className="icon" />
                  <span>{t(`backoffice.page.${p}`)}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="bo-sidebar-user">
          <span className="user-avatar"><IconUser className="icon" /></span>
          <div className="bo-sidebar-user-name">{t('backoffice.common.operator')}</div>
          <button type="button" className="btn-icon" onClick={onLogout} title={t('backoffice.common.logout')}>
            <IconLogout className="icon" />
          </button>
        </div>
      </aside>

      <div className="bo-main-col">
        <header className="bo-topbar">
          <h1>{t(`backoffice.page.${route.page}`)}</h1>
          <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
            {SUPPORTED_LOCALES.map((l) => (
              <option key={l} value={l}>{l.toUpperCase()}</option>
            ))}
          </select>
        </header>
        <main className="content">
          {children}
        </main>
      </div>
    </div>
  )
}
