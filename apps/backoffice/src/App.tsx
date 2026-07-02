import { useEffect, useState, type ComponentType } from 'react'
import { setOnUnauthorized } from './api'
import { useRoute } from './shell/useRoute'
import { AppShell } from './shell/AppShell'
import { ToastProvider } from './ui/Toast'
import type { PageProps } from './pages/types'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Sales } from './pages/Sales'
import { Products } from './pages/Products'
import { Stock } from './pages/Stock'
import { Recipes } from './pages/Recipes'
import { Production } from './pages/Production'
import { Checklists } from './pages/Checklists'
import { ChecklistReports } from './pages/ChecklistReports'
import { Customers } from './pages/Customers'
import { Loyalty } from './pages/Loyalty'
import { Vouchers } from './pages/Vouchers'
import { Campaigns } from './pages/Campaigns'
import { Exports } from './pages/Exports'

const PAGES: Record<string, ComponentType<PageProps>> = {
  dashboard: Dashboard,
  stock: Stock,
  production: Production,
  checklists: Checklists,
  products: Products,
  recipes: Recipes,
  crm: Customers,
  loyalty: Loyalty,
  vouchers: Vouchers,
  campaigns: Campaigns,
  sales: Sales,
  haccp: ChecklistReports,
  exports: Exports,
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const { route, navigate } = useRoute()

  useEffect(() => {
    setOnUnauthorized(() => {
      localStorage.removeItem('token')
      setToken(null)
    })
    return () => setOnUnauthorized(null)
  }, [])

  if (!token) {
    return (
      <Login
        onLogin={(tk) => {
          localStorage.setItem('token', tk)
          setToken(tk)
        }}
      />
    )
  }

  const Page = PAGES[route.page] ?? Dashboard
  return (
    <ToastProvider>
      <AppShell
        route={route}
        navigate={navigate}
        onLogout={() => {
          localStorage.removeItem('token')
          setToken(null)
        }}
      >
        <Page token={token} navigate={navigate} />
      </AppShell>
    </ToastProvider>
  )
}
