import { useTranslation } from 'react-i18next'

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="error-state">
      <span>{t('backoffice.common.loadError')}</span>
      <button onClick={onRetry}>{t('backoffice.common.retry')}</button>
    </div>
  )
}
