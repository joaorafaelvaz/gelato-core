// Ícones de traço único (estilo outline), sem cor própria — herdam `currentColor`
// do elemento pai. Substituem os emojis coloridos por um visual mais sóbrio.
type IconProps = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function IconSearch({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

export function IconBarcode({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M21 5v14" strokeWidth="1.3" />
    </svg>
  )
}

export function IconChair({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 4v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4" />
      <path d="M7 15v5M17 15v5M6 9h12" />
    </svg>
  )
}

export function IconReceipt({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6V3Z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

export function IconMoreVertical({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconMoreHorizontal({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none" />
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

export function IconTrash({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7h14M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  )
}

export function IconGrid({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </svg>
  )
}

export function IconList({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="0.9" fill="currentColor" stroke="none" />
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

export function IconWifi({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 8.5a14 14 0 0 1 18 0" />
      <path d="M6.2 12.3a9.4 9.4 0 0 1 11.6 0" />
      <path d="M9.4 16a4.8 4.8 0 0 1 5.2 0" />
      <circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconSun({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  )
}

export function IconMoon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </svg>
  )
}

export function IconStar({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7Z" />
    </svg>
  )
}

export function IconPrinter({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 8.5V3h12v5.5" />
      <rect x="4" y="8.5" width="16" height="8" rx="1.5" />
      <path d="M6 15.5h12V21H6Z" />
    </svg>
  )
}

export function IconChevronDown({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function IconDrawer({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M3.5 12h17M10.5 16h3" />
    </svg>
  )
}

export function IconPercent({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.4" />
      <circle cx="17" cy="17" r="2.4" />
    </svg>
  )
}

export function IconMessage({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 5.5h16v10H9l-4 3.5v-3.5H4Z" />
    </svg>
  )
}

// ── Ícones de categoria (gelateria) ──

function IconIceCream({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 10a5 5 0 0 1 10 0" />
      <path d="M7 10h10l-4.1 10.4a1 1 0 0 1-1.8 0L7 10Z" />
    </svg>
  )
}

function IconBag({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 8a3 3 0 0 1 6 0" />
      <path d="M6 8h12l-1 12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 8Z" />
    </svg>
  )
}

function IconPlusCircle({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  )
}

function IconBottle({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M10 2h4v3.2l1.5 2.3V20a1.4 1.4 0 0 1-1.4 1.4h-4.2A1.4 1.4 0 0 1 8.5 20V7.5L10 5.2V2Z" />
      <path d="M9.5 11.5h5" />
    </svg>
  )
}

function IconCupStraw({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M8 8h9l-1 12.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1L8 8Z" />
      <path d="M9.5 8 8.8 3.5h6.4L14.5 8" />
      <path d="M14 3.5 12.8 1" />
    </svg>
  )
}

function IconCoffee({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 8h13v6a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5V8Z" />
      <path d="M17.5 9.2H19a2.3 2.3 0 0 1 0 4.6h-1.5" />
      <path d="M8.5 3.5c-.6 1 .5 1.4-.2 2.5M12.5 3.5c-.6 1 .5 1.4-.2 2.5" />
    </svg>
  )
}

function IconWaffle({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" strokeWidth="1.3" />
    </svg>
  )
}

function IconCrepe({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 15c3-5.5 14-5.5 17 0" />
      <path d="M6 11.3c2.2-3.4 9.8-3.4 12 0" />
    </svg>
  )
}

function IconSprinkles({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6.5 8 8.5M14 4l1.6 1.6M18 10l1.6 1.6M5 13l1.6 1.6M11 15l1.6 1.6M16 16.5l1.6 1.6" />
    </svg>
  )
}

function IconCherries({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="8" cy="17" r="3" />
      <circle cx="15.5" cy="18" r="3" />
      <path d="M8 14 11 4.5M15.5 15 12.5 4.5" />
    </svg>
  )
}

function IconSundae({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 9h15" />
      <path d="M6 9l2.2 9.6a2 2 0 0 0 2 1.5h3.6a2 2 0 0 0 2-1.5L18 9" />
      <path d="M12 3v4" />
    </svg>
  )
}

function IconPlate({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  )
}

function IconCake({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 12h16v7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-7Z" />
      <path d="M4 12a3 3 0 0 1 3-3 3 3 0 0 1 3 3M10 12a3 3 0 0 1 3-3 3 3 0 0 1 3 3M16 12a3 3 0 0 1 3-3 3 3 0 0 1 1 .2" />
      <path d="M12 9V5M12 5c-.9 0-1.4-.6-1.4-1.2S11.1 2.6 12 2c.9.6 1.4 1.2 1.4 1.8S12.9 5 12 5Z" />
    </svg>
  )
}

function IconPretzel({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 5c-2 1.4-2.2 4 .5 4.3C9.5 9.6 9 5 12 5s2.5 4.6 5.5 4.3C20.2 9 20 6.4 18 5" />
      <path d="M6.5 9.2 5 19M17.5 9.2 19 19" />
      <path d="M9.3 13.5h5.4" />
    </svg>
  )
}

const CATEGORY_ICONS: Record<string, (props: IconProps) => JSX.Element> = {
  'Eis': IconIceCream,
  'Eis im Becher': IconSundae,
  'Warme Getränke': IconCoffee,
  'Kalte Getränke': IconCupStraw,
  'Waffeln und Crêpe': IconWaffle,
  'Kuchen und Torte': IconCake,
  'Snacks': IconPretzel,
  'Extras': IconPlusCircle,
  // nomes antigos — mantidos como fallback caso ainda existam em algum tenant não migrado
  'Para Viagem': IconBag,
  'Refrigerantes': IconBottle,
  'Bebidas Especiais': IconCupStraw,
  'Café': IconCoffee,
  'Waffles': IconWaffle,
  'Crepes': IconCrepe,
  'Toppings': IconSprinkles,
  'Frutas': IconCherries,
  'Eisbecher (Taças)': IconSundae,
  'Sabores Clássicos': IconIceCream,
  'Sabores de Frutas': IconIceCream,
  'Sabores Premium': IconIceCream,
}

export function CategoryIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name ? CATEGORY_ICONS[name] : undefined) ?? IconPlate
  return <Icon className={className} />
}
