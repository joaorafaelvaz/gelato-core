import { useTranslation } from 'react-i18next';

export function DashboardPage() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('dashboard.title')}</h1>
      <p className="text-gray-600">{t('dashboard.welcome')}</p>
    </div>
  );
}
