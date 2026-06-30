import { useTranslation } from 'react-i18next';

export function UsersPage() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">{t('navigation.users')}</h1>
      <p className="text-gray-600">User management will be implemented here.</p>
    </div>
  );
}
