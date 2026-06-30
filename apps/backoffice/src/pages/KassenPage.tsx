import { useTranslation } from 'react-i18next';

export function KassenPage() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('navigation.kassen')}</h1>
      <p className="text-gray-600">Cash register management will be implemented here.</p>
    </div>
  );
}
