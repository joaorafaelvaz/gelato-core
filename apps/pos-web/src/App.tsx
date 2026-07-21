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
  IconEdit,
  IconGrid,
  IconList,
  IconMoreHorizontal,
  IconMoreVertical,
  IconReceipt,
  IconSearch,
  IconTrash,
  IconUser,
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

const LANG_LABEL: Record<string, string> = { de: 'DE', en: 'EN', pt: 'PT' }

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
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [rates, setRates] = useState<TaxRate[]>([])
  const [cart, setCart] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [noteOpenFor, setNoteOpenFor] = useState<string | null>(null)
  const [discountCents, setDiscountCents] = useState(0)
  const [mode, setMode] = useState<Mode>('im_haus')
  const [qr, setQr] = useState<string | null>(null)
  const [report, setReport] = useState<string>('')
  const [msg, setMsg] = useState('')
  const [ausfall, setAusfall] = useState(false)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [view, setView] = useState<'shop' | 'salon'>('shop')

  useEffect(() => {
    void store.getAusfallState().then((s) => {
      ausfallTracker = new AusfallTracker(s)
      setAusfall(s !== null)
    })
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
      const cats = await getCategories(r.access_token)
      setCategories(cats)
      setActiveCategory(cats[0]?.id ?? null)
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
    return !activeCategory || p.categoryId === activeCategory
  })
  const categoryName = (categoryId?: string | null): string | undefined =>
    categories.find((c) => c.id === categoryId)?.name

  const currentCategoryName = search.trim()
    ? t('pos.search.results')
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

  return (
    <>
      {ausfall && (
        <div className="banner-ausfall">
          {t('pos.ausfall.banner')}
        </div>
      )}
      <div className="pos-app">
        <aside className="pos-sidebar">
          <div className="pos-sidebar-logo">
            <img src="/skyview-logo.png" alt="Skyview" />
            <span className="pos-sidebar-tagline">{t('pos.menu.tagline')}</span>
          </div>
          <div className="pos-sidebar-lang">
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
          <nav className="pos-categories">
            {categories.map((c) => (
              <button
                key={c.id}
                className={view === 'shop' && !search.trim() && activeCategory === c.id ? 'cat-btn active' : 'cat-btn'}
                onClick={() => {
                  setView('shop')
                  setSearch('')
                  setActiveCategory(c.id)
                }}
              >
                <span className="cat-icon"><CategoryIcon name={c.name} className="icon" /></span>
                <span className="cat-label">{c.name}</span>
              </button>
            ))}
          </nav>
          <div className="pos-sidebar-divider" />
          <nav className="pos-categories">
            <button
              className={view === 'salon' ? 'cat-btn active' : 'cat-btn'}
              onClick={() => setView('salon')}
            >
              <span className="cat-icon"><IconChair className="icon" /></span>
              <span className="cat-label">{t('pos.salon.title')}</span>
            </button>
          </nav>
          <div className="pos-categories-user">
            <span className="user-avatar"><IconUser className="icon" /></span>
            <div>
              <div className="user-name">{t('pos.menu.operator')}</div>
              <div className="user-shift">{t('pos.shift.open')} · #{shiftId?.slice(0, 6)}</div>
            </div>
          </div>
        </aside>

        <div className="pos-main-col">
          <header className="topbar">
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
            <div className="topbar-right">
              <button className="btn-ghost" onClick={() => setView('salon')}><IconChair className="icon" /> {t('pos.menu.tables')}</button>
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
                <button className="btn-icon" onClick={() => setMenuOpen((v) => !v)} title={t('pos.menu.more')}><IconMoreVertical className="icon" /></button>
                {menuOpen && (
                  <div className="topbar-menu-panel">
                    <button onClick={() => void cashMovement(token, shiftId, 'sangria', askCents(`${t('pos.cash.sangria')} (€)`))}>{t('pos.cash.sangria')}</button>
                    <button onClick={() => void cashMovement(token, shiftId, 'suprimento', askCents(`${t('pos.cash.suprimento')} (€)`))}>{t('pos.cash.suprimento')}</button>
                    <button onClick={() => void drawerOpen(token)}>{t('pos.cash.drawer')}</button>
                    <button onClick={() => void doX()}>X-Bericht</button>
                    <button onClick={() => void doZ()}>Z-Bericht</button>
                    <button onClick={() => void close()}>{t('pos.shift.close')}</button>
                    {report && <p className="report-line">{report}</p>}
                  </div>
                )}
              </div>
              <button className="btn-primary" onClick={cancelCart}>+ {t('pos.menu.newOrder')}</button>
            </div>
          </header>

          {view === 'shop' ? (
          <>
          <div className="pos-shop">
            <main className="pos-products">
              <div className="pos-products-header">
                <h2>{currentCategoryName}</h2>
                <div className="pos-view-toggle">
                  <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="Grid"><IconGrid className="icon" /></button>
                  <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="Liste"><IconList className="icon" /></button>
                </div>
              </div>
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
              </div>
            </main>

            <aside className="pos-cart">
              <div className="pos-cart-header">
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
                      <div className="cart-line-thumb">
                        {p.imageUrl ? <img src={imageUrlFor(p.imageUrl)!} alt="" /> : <CategoryIcon name={categoryName(p.categoryId)} className="icon" />}
                      </div>
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
              <div className="cart-buttons">
                <button className="btn-secondary" onClick={cancelCart} disabled={Object.keys(cart).length === 0}>
                  {t('pos.cart.cancel')}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => void finalize()}
                  disabled={Object.keys(cart).length === 0}
                >
                  {t('pos.cart.pay')}
                </button>
              </div>
            </aside>
          </div>

          <div className="pos-summary-bar">
            <div className="pos-summary-stats">
              <span><strong>{cartCount}</strong> {t('pos.summary.items')}</span>
              <span>{t('pos.cart.subtotal')} <strong>{euro(cartTotal)}</strong></span>
              <span>{t('pos.cart.discount')} <strong>{euro(discountCents)}</strong></span>
              <span>{t('pos.cart.total')} <strong>{euro(cartTotalWithDiscount)}</strong></span>
            </div>
            <div className="pos-summary-actions">
              <a className="btn-ghost" href={backofficeUrl()} target="_blank" rel="noreferrer"><IconEdit className="icon" /> {t('pos.menu.editProducts')}</a>
              <button type="button" className="btn-ghost" onClick={() => setMenuOpen(true)}><IconMoreHorizontal className="icon" /> {t('pos.menu.more')}</button>
            </div>
          </div>
          </>
          ) : (
          <div className="pos-salon">
            <h2 className="pos-salon-title">{t('pos.salon.title')}</h2>
            <TischPanel token={token} kasse={KASSE} products={products} rates={rates} tse={tse} />
          </div>
          )}
        </div>
      </div>
    </>
  )
}
