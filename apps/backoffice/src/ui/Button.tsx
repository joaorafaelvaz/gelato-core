import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'default', className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' }) {
  const cls = variant === 'default' ? '' : `btn-${variant}`
  return <button {...rest} className={[cls, className].filter(Boolean).join(' ') || undefined} />
}
