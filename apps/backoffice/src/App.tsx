import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { TenantsPage } from './pages/TenantsPage';
import { UsersPage } from './pages/UsersPage';
import { BranchesPage } from './pages/BranchesPage';
import { KassenPage } from './pages/KassenPage';
import { ProductsPage } from './pages/ProductsPage';
import { IngredientsPage } from './pages/IngredientsPage';
import { StockPage } from './pages/StockPage';
import { FiscalDashboardPage } from './pages/FiscalDashboardPage';
import { TseManagementPage } from './pages/TseManagementPage';
import { SalesDashboardPage } from './pages/SalesDashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { LoyaltyPage } from './pages/LoyaltyPage';
import { VouchersPage } from './pages/VouchersPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { CampaignsPage } from './pages/CampaignsPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/tenants" element={<TenantsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/branches" element={<BranchesPage />} />
            <Route path="/kassen" element={<KassenPage />} />
            <Route path="/products" element={<ProductsPage />} />
            <Route path="/ingredients" element={<IngredientsPage />} />
            <Route path="/stock" element={<StockPage />} />
            <Route path="/fiscal" element={<FiscalDashboardPage />} />
            <Route path="/tse" element={<TseManagementPage />} />
            <Route path="/sales" element={<SalesDashboardPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="/loyalty" element={<LoyaltyPage />} />
            <Route path="/vouchers" element={<VouchersPage />} />
            <Route path="/promotions" element={<PromotionsPage />} />
            <Route path="/campaigns" element={<CampaignsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
