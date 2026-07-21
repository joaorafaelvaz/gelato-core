// Ícones de traço único (mesma linguagem visual do POS) — herdam `currentColor`.
type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function IconChart({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M3 20h18" />
    </svg>
  )
}

function IconBox({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 8 12 4l8.5 4-8.5 4-8.5-4Z" />
      <path d="M3.5 8v8L12 20l8.5-4V8" />
      <path d="M12 12v8" />
    </svg>
  )
}

function IconFlask({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9.5 3h5M10 3v6.5L4.8 19a1.5 1.5 0 0 0 1.3 2.2h11.8a1.5 1.5 0 0 0 1.3-2.2L14 9.5V3" />
      <path d="M7.5 15h9" />
    </svg>
  )
}

function IconClipboardCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="m9 13 2 2 4-4.5" />
    </svg>
  )
}

function IconTag({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12.5 3H5a1 1 0 0 0-1 1v7.5a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.2-.1Z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </svg>
  )
}

function IconBook({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" />
      <path d="M4 18a2.5 2.5 0 0 1 2.5-2.5H20" />
    </svg>
  )
}

function IconUsers({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c.8-3.4 3-5 5.5-5s4.7 1.6 5.5 5" />
      <circle cx="17" cy="8.5" r="2.3" />
      <path d="M15.7 12.2c1.9.5 3.3 1.9 3.9 4.4" />
    </svg>
  )
}

function IconStar({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3.5 14.5 9l6 .9-4.3 4.2 1 6-5.2-2.8-5.2 2.8 1-6-4.3-4.2 6-.9L12 3.5Z" />
    </svg>
  )
}

function IconTicket({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 1.6 1.6 0 0 0 0 3.2 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 1.6 1.6 0 0 0 0-3.2Z" transform="rotate(180 12 12)" />
      <path d="M9.5 6.5v11" strokeDasharray="2.2 2.2" />
    </svg>
  )
}

function IconMegaphone({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l1.5 5H11l-1-5h1L20 19V5l-8.5 4H7a1 1 0 0 0-1 1v0" />
      <path d="M18 8.5v7" />
    </svg>
  )
}

function IconReceiptBO({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

function IconShieldCheck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3 5 6v6c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4.5" />
    </svg>
  )
}

function IconDownload({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3v12M8 11.5 12 15l4-3.5" />
      <path d="M4 17.5V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" />
    </svg>
  )
}

export function IconEdit({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    </svg>
  )
}

export function IconLogout({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 16l4-4-4-4M19 12H9" />
    </svg>
  )
}

export function IconUser({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
    </svg>
  )
}

const PAGE_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  dashboard: IconChart,
  stock: IconBox,
  production: IconFlask,
  checklists: IconClipboardCheck,
  products: IconTag,
  recipes: IconBook,
  crm: IconUsers,
  loyalty: IconStar,
  vouchers: IconTicket,
  campaigns: IconMegaphone,
  sales: IconReceiptBO,
  haccp: IconShieldCheck,
  exports: IconDownload,
}

export function PageIcon({ page, className }: { page: string; className?: string }) {
  const Icon = PAGE_ICONS[page] ?? IconTag
  return <Icon className={className} />
}
