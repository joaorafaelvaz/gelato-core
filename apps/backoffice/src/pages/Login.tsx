import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { apiLogin } from '../api'

export function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('admin@demo.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(false)
    try {
      const result = await apiLogin(email, password)
      onLogin(result.access_token)
    } catch {
      setError(true)
    }
  }

  return (
    <form onSubmit={submit} className="card login">
      <h1>{t('common.appName')}</h1>
      <label>
        {t('auth.login.email')}
        <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        {t('auth.login.password')}
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button type="submit" className="btn-primary">{t('auth.login.submit')}</button>
      {error && <span className="login-error">{t('backoffice.common.loginFailed')}</span>}
    </form>
  )
}
