import { useTranslation } from 'react-i18next';

export function BranchesPage() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('navigation.branches')}</h1>
      <p className="text-gray-600">Branch management will be implemented here.</p>
    </div>
  );
}
