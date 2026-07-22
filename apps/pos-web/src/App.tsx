import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { FakeTseProvider, AusfallTracker, type TaxRate } from '@gelato/compliance'
import { SUPPORTED_LOCALES } from '@gelato/i18n'
import { IdbStore } from './idb-store'
import { TischPanel } from './TischPanel'
import { finalizeSale, runOutboxOnce, HttpSyncClient, type CartLine } from './sale'
import {
  CategoryIcon,
  IconBarcode,
  IconChair,
  IconChevronDown,
  IconDrawer,
  IconEdit,
  IconGrid,
  IconList,
  IconMessage,
  IconMoon,
  IconMoreHorizontal,
  IconMoreVertical,
  IconPercent,
  IconPrinter,
  IconReceipt,
  IconSearch,
  IconStar,
  IconSun,
  IconTrash,
  IconUser,
  IconWifi,
} from './icons'
import {
  apiBase,
  backofficeUrl,
  imageUrlFor,
  getProducts,
  getTaxRates,
  getCategories,
  loginPin,
  openShift,
  closeShift,
  cashMovement,
  drawerOpen,
  reportX,
  reportZ,
  type ApiProduct,
  type ApiCategory,
  type DayTotals,
} from './api'

type Mode = 'im_haus' | 'ausser_haus'
type Theme = 'light' | 'dark'

const LANG_LABEL: Record<string, string> = { de: 'DE', en: 'EN', pt: 'PT' }
// Aba "Favoritos": não é uma categoria real do banco, filtra por products[].featured.
const FAVORITOS_ID = '__favoritos__'

const KASSE = 'demo-kasse'
const store = new IdbStore()
const tse = new FakeTseProvider({ serialNumber: 'WEB-SANDBOX' })
let ausfallTracker = new AusfallTracker()
const euro = (c: number): string =>
  (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const askCents = (label: string): number => Math.round(Number(window.prompt(label) ?? '0') * 100)

export function App() {
  const { t, i18n } = useTranslation()
  const [token, setToken] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [float, setFloat] = useState('100')
  const [products, setProducts] = useState<ApiProduct[]>([])
  const [categories, setCategories] = useState<ApiCategory[]>([])
  const [activeCategory, setActiveCategory] = useState<string>(FAVORITOS_ID)
  const [rates, setRates] = useState<TaxRate[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  const [discountCents, setDiscountCents] = useState(0)
  const [orderNote, setOrderNote] = useState('')
  const [mode, setMode] = useState<Mode>('ausser_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [report, setReport] = useState<string>('')
  const [msg, setMsg] = useState('')
  const [ausfall, setAusfall] = useState(false)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [view, setView] = useState<'shop' | 'salon'>('shop')
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('pos-theme') as Theme | null) ?? 'light')
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    void store.getAusfallState().then((s) => {
      ausfallTracker = new AusfallTracker(s)
      setAusfall(s !== null)
    })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pos-theme', theme)
  }, [theme])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!token) return
    const client = new HttpSyncClient(apiBase(), token)
    const id = setInterval(() => void runOutboxOnce(store, client).catch(() => {}), 5000)
    return () => clearInterval(id)
  }, [token])

  async function login(): Promise<void> {
    try {
      const r = await loginPin(KASSE, pin)
      setToken(r.access_token)
      setProducts(await getProducts(r.access_token))
      setCategories(await getCategories(r.access_token))
      const tr = await getTaxRates(r.access_token)
      setRates(
        tr.map((x) => ({
          code: x.code,
          rate: Number(x.rate),
          validFrom: new Date(x.validFrom),
          validTo: x.validTo ? new Date(x.validTo) : undefined,
        })),
      )
      setMsg('')
    } catch {
      setMsg(t('pos.login.invalidPin'))
    }
  }

  async function open(): Promise<void> {
    const s = await openShift(token!, KASSE, Math.round(Number(float) * 100))
    setShiftId(s.id)
  }

  function add(id: string): void {
    setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }))
  }

  function decrement(id: string): void {
    setCart((c) => {
      const next = { ...c }
      const qty = (next[id] ?? 0) - 1
      if (qty <= 0) delete next[id]
      else next[id] = qty
      return next
    })
  }

  function removeLine(id: string): void {
    setCart((c) => {
      const next = { ...c }
      delete next[id]
      return next
    })
    setNotes((n) => {
      const next = { ...n }
      delete next[id]
      return next
    })
  }

  function cancelCart(): void {
    setCart({})
    setNotes({})
    setNoteOpenFor(null)
    setDiscountCents(0)
  }

  async function finalize(): Promise<void> {
    const items: CartLine[] = products
      .filter((p) => cart[p.id])
      .map((p) => ({
        product: {
          id: p.id,
          name: p.name,
          netCents: p.netCents,
          mwstCodeImHaus: p.mwstCodeImHaus,
          mwstCodeAusserHaus: p.mwstCodeAusserHaus,
        },
        qty: cart[p.id]!,
      }))
    if (items.length === 0) return
    const { receipt, outcome } = await finalizeSale({
      cart: items,
      mode,
      at: new Date(),
      rates,
      kasseId: KASSE,
      shiftId: shiftId ?? undefined,
      tseClientId: 'c1',
      tse,
      store,
      seller: { name: 'Gelateria Demo (Web)' },
      tracker: ausfallTracker,
    })
    setAusfall(outcome.kind === 'ausfall' || ausfallTracker.current !== null)
    setQr(receipt.qrPayload ? await QRCode.toDataURL(receipt.qrPayload) : null)
    cancelCart()
  }

  const cartTotal = products.reduce((sum, p) => sum + p.netCents * (cart[p.id] ?? 0), 0)
  const cartTotalWithDiscount = Math.max(0, cartTotal - discountCents)
  const cartCount = Object.values(cart).reduce((n, q) => n + q, 0)
  const filteredProducts = products.filter((p) => {
    if (search.trim()) return p.name.toLowerCase().includes(search.trim().toLowerCase())
    if (activeCategory === FAVORITOS_ID) return p.featured
    return p.categoryId === activeCategory
  })
  const categoryName = (categoryId?: string | null): string | undefined =>
    categories.find((c) => c.id === categoryId)?.name

  const currentCategoryName = search.trim()
    ? t('pos.search.results')
    : activeCategory === FAVORITOS_ID
      ? t('pos.menu.favorites')
      : (categories.find((c) => c.id === activeCategory)?.name ?? '')

  const totalsLine = (d: DayTotals): string =>
    `Σ ${euro(d.totalGross)} · ${d.byVatRate.map((g) => `${(g.rate * 100).toFixed(0)}%=${euro(g.gross)}`).join(' · ')}`

  async function doX(): Promise<void> {
    const r = await reportX(token!, KASSE)
    setReport(`X-Bericht — ${totalsLine(r.totals)}`)
  }
  async function doZ(): Promise<void> {
    const r = await reportZ(token!, KASSE)
    setReport(`Z-Bericht #${r.seqNr} — ${totalsLine(r.totals)}`)
  }
  async function close(): Promise<void> {
    const counted = askCents(t('pos.shift.countedPrompt'))
    const s = await closeShift(token!, shiftId!, counted)
    setReport(t('pos.shift.closedReport', { diff: euro(s.differenz ?? 0) }))
    setShiftId(null)
  }

  // --- telas ---
  if (!token) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <img src="/skyview-logo-transparent.png" alt="Skyview" style={{ height: 56, width: 'auto', margin: '0 auto' }} />
          <h1>{t('common.appName')} · Kasse</h1>
          <input value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t('auth.login.pin')} type="password" />
          <button className="btn-primary btn-big" onClick={() => void login()}>{t('auth.login.submit')}</button>
          {msg && <span className="error-text">{msg}</span>}
        </div>
      </div>
    )
  }

  if (!shiftId) {
    return (
      <div className="center-screen">
        <div className="card login-card">
          <h2>{t('pos.shift.closed')}</h2>
          <label style={{ justifyContent: 'center' }}>
            {t('pos.shift.float')}{' '}
            <input value={float} onChange={(e) => setFloat(e.target.value)} style={{ width: 100 }} />
          </label>
          <button className="btn-primary btn-big" onClick={() => void open()}>{t('pos.shift.open')}</button>
          {report && <p className="report-line">{report}</p>}
        </div>
      </div>
    )
  }

  const clock = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString('de-DE')

  return (
    <>
      {ausfall && (
        <div className="banner-ausfall">
          {t('pos.ausfall.banner')}
        </div>
      )}
      <div className="pos-app-v2">
        <header className="pos-header">
          <div className="pos-header-logo">
            <img src="/skyview-logo.png" alt="Skyview" />
            <span className="pos-header-tagline">{t('pos.menu.tagline')}</span>
          </div>

          <nav className="view-tabs">
            <button className={view === 'shop' ? 'view-tab active' : 'view-tab'} onClick={() => setView('shop')}>
              <IconPrinter className="icon" /> {t('pos.menu.caixa')}
            </button>
            <button className={view === 'salon' ? 'view-tab active' : 'view-tab'} onClick={() => setView('salon')}>
              <IconChair className="icon" /> {t('pos.menu.tables')}
            </button>
          </nav>

          <div className="pos-header-right">
            <div className="topbar-lang">
              {SUPPORTED_LOCALES.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={i18n.language === l ? 'lang-btn active' : 'lang-btn'}
                  onClick={() => void i18n.changeLanguage(l)}
                >
                  {LANG_LABEL[l]}
                </button>
              ))}
            </div>
            <button type="button" className="btn-icon theme-toggle" onClick={() => setTheme((th) => (th === 'light' ? 'dark' : 'light'))} title={t('pos.menu.theme')}>
              {theme === 'light' ? <IconMoon className="icon" /> : <IconSun className="icon" />}
            </button>
            <div className="topbar-menu">
              <button className="btn-icon" onClick={() => setQrOpen((v) => !v)} title={t('pos.receipt.title')}><IconReceipt className="icon" /></button>
              {qrOpen && (
                <div className="topbar-menu-panel topbar-qr-panel">
                  {qr ? (
                    <div className="qr-box"><img src={qr} alt="QR" /></div>
                  ) : (
                    <p className="muted">{ausfall ? t('pos.ausfall.noQr') : t('pos.receipt.none')}</p>
                  )}
                </div>
              )}
            </div>
            <div className="topbar-menu">
              <button type="button" className="user-badge" onClick={() => setMenuOpen((v) => !v)}>
                <span className="user-avatar"><IconUser className="icon" /></span>
                <div className="user-badge-info">
                  <div className="user-name">{t('pos.menu.operator')}</div>
                  <div className="user-shift">{t('pos.shift.open')}</div>
                </div>
                <IconChevronDown className="icon" />
              </button>
              {menuOpen && (
                <div className="topbar-menu-panel">
                  <a className="btn-ghost" href={backofficeUrl()} target="_blank" rel="noreferrer"><IconEdit className="icon" /> {t('pos.menu.editProducts')}</a>
                  <button onClick={cancelCart}>+ {t('pos.menu.newOrder')}</button>
                  <button onClick={() => void cashMovement(token, shiftId, 'sangria', askCents(`${t('pos.cash.sangria')} (€)`))}>{t('pos.cash.sangria')}</button>
                  <button onClick={() => void cashMovement(token, shiftId, 'suprimento', askCents(`${t('pos.cash.suprimento')} (€)`))}>{t('pos.cash.suprimento')}</button>
                  <button onClick={() => void doX()}>X-Bericht</button>
                  <button onClick={() => void doZ()}>Z-Bericht</button>
                  <button onClick={() => void close()}>{t('pos.shift.close')}</button>
                  {report && <p className="report-line">{report}</p>}
                </div>
              )}
            </div>
            <div className="pos-clock">
              <div className="pos-clock-time">{clock}</div>
              <div className="pos-clock-date">{dateStr}</div>
            </div>
            <IconWifi className="icon wifi-icon" />
          </div>
        </header>

        {view === 'shop' ? (
        <>
        <div className="pos-toolbar">
          <div className="topbar-search">
            <IconSearch className="icon topbar-search-icon" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pos.search.placeholder')}
            />
            <IconBarcode className="icon topbar-search-icon" />
          </div>
          <div className="seg seg-compact">
            <button className={mode === 'im_haus' ? 'active' : ''} onClick={() => setMode('im_haus')}>{t('pos.mode.im_haus')}</button>
            <button className={mode === 'ausser_haus' ? 'active' : ''} onClick={() => setMode('ausser_haus')}>{t('pos.mode.ausser_haus')}</button>
          </div>
        </div>

        <div className="pos-body">
        <aside className="pos-category-sidebar">
          <nav className="cat-nav">
            <button
              className={!search.trim() && activeCategory === FAVORITOS_ID ? 'cat-btn active' : 'cat-btn'}
              onClick={() => { setSearch(''); setActiveCategory(FAVORITOS_ID) }}
            >
              <span className="cat-icon"><IconStar className="icon" /></span>
              <span className="cat-label">{t('pos.menu.favorites')}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={!search.trim() && activeCategory === c.id ? 'cat-btn active' : 'cat-btn'}
                onClick={() => { setSearch(''); setActiveCategory(c.id) }}
              >
                <span className="cat-icon"><CategoryIcon name={c.name} className="icon" /></span>
                <span className="cat-label">{c.name}</span>
              </button>
            ))}
          </nav>
          <div className="pos-view-toggle pos-view-toggle-sidebar">
            <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid"><IconGrid className="icon" /></button>
            <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="Liste"><IconList className="icon" /></button>
          </div>
        </aside>

        <div className="pos-shop">
          <main className="pos-products">
            <div className={viewMode === 'grid' ? 'product-grid' : 'product-list'}>
              {filteredProducts.map((p) => (
                <button key={p.id} className={viewMode === 'grid' ? 'product-card' : 'product-row'} onClick={() => add(p.id)}>
                  <div className="product-thumb">
                    {p.imageUrl ? (
                      <img src={imageUrlFor(p.imageUrl)!} alt="" />
                    ) : (
                      <CategoryIcon name={categoryName(p.categoryId)} className="icon" />
                    )}
                  </div>
                  <div className="product-name">{p.name}</div>
                  <div className="product-price">{euro(p.netCents)}</div>
                  {cart[p.id] ? <span className="count">×{cart[p.id]}</span> : null}
                </button>
              ))}
              {filteredProducts.length === 0 && <p className="muted">{t('pos.cart.empty')}</p>}
            </div>
          </main>

          <aside className="pos-cart">
            <div className="pos-cart-header">
              <IconReceipt className="icon" />
              <h3>{t('pos.cart.title')}</h3>
              <button type="button" className="btn-icon" onClick={cancelCart} disabled={cartCount === 0} title={t('pos.cart.cancel')}><IconTrash className="icon" /></button>
            </div>
            <div className="cart-lines">
          {Object.keys(cart).length === 0 ? (
            <p className="muted">{t('pos.cart.empty')}</p>
          ) : (
            products
              .filter((p) => cart[p.id])
              .map((p) => (
                <div key={p.id} className="cart-line">
                  <div className="cart-line-main">
                    <span className="cart-line-qty-badge">{cart[p.id]}</span>
                    <div className="cart-line-info">
                      <span>{p.name}</span>
                      {notes[p.id] && <span className="cart-line-note">{notes[p.id]}</span>}
                    </div>
                    <strong>{euro(p.netCents * cart[p.id]!)}</strong>
                    <button type="button" className="cart-line-remove" onClick={() => removeLine(p.id)}><IconTrash className="icon" /></button>
                  </div>
                  <div className="cart-line-qty">
                    <button type="button" onClick={() => decrement(p.id)}>−</button>
                    <span>{cart[p.id]}</span>
                    <button type="button" onClick={() => add(p.id)}>+</button>
                    <button
                      type="button"
                      className="cart-line-note-btn"
                      onClick={() => setNoteOpenFor(noteOpenFor === p.id ? null : p.id)}
                    >
                      {t('pos.cart.addNote')}
                    </button>
                  </div>
                  {noteOpenFor === p.id && (
                    <input
                      className="cart-line-note-input"
                      value={notes[p.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                      placeholder={t('pos.cart.notePlaceholder')}
                      autoFocus
                    />
                  )}
                </div>
              ))
          )}
        </div>
            <button type="button" className="cart-add-note-row" onClick={() => setOrderNote(window.prompt(t('pos.note.prompt'), orderNote) ?? orderNote)}>
              <IconMessage className="icon" /> {orderNote || t('pos.note.order')}
            </button>
            <div className="cart-totals">
              <div className="cart-total-row">
                <span>{t('pos.cart.subtotal')}</span>
                <span>{euro(cartTotal)}</span>
              </div>
              <div className="cart-total-row">
                <span>{t('pos.cart.discount')}</span>
                <input
                  className="cart-discount-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountCents ? (discountCents / 100).toFixed(2) : ''}
                  onChange={(e) => setDiscountCents(Math.max(0, Math.round(Number(e.target.value || '0') * 100)))}
                  placeholder="0,00"
                />
              </div>
              <div className="cart-total-row cart-total-row-final">
                <span>{t('pos.cart.total')}</span>
                <strong>{euro(cartTotalWithDiscount)}</strong>
              </div>
            </div>
            <button
              className="btn-pay-big"
              onClick={() => void finalize()}
              disabled={Object.keys(cart).length === 0}
            >
              <span>{t('pos.cart.pay')}</span>
              <span>{euro(cartTotalWithDiscount)}</span>
            </button>
          </aside>
        </div>
        </div>

        <div className="pos-bottom-bar">
          <button onClick={() => setDiscountCents(askCents(`${t('pos.cart.discount')} (€)`))}><IconPercent className="icon" /> {t('pos.cart.discount')}</button>
          <button onClick={() => setOrderNote(window.prompt(t('pos.note.prompt'), orderNote) ?? orderNote)}><IconMessage className="icon" /> {t('pos.note.order')}</button>
          <button onClick={() => void drawerOpen(token)}><IconDrawer className="icon" /> {t('pos.cash.drawer')}</button>
        </div>
        </>
        ) : (
        <div className="pos-salon">
          <TischPanel token={token} kasse={KASSE} products={products} rates={rates} tse={tse} />
        </div>
        )}
      </div>
    </>
  )
}
