import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { usePos } from '../contexts/PosContext';
import {
  fetchProducts,
  openShift,
  closeShift,
  fetchShifts,
  createOrder,
  finalizeOrder,
  type Product,
  type Shift,
  type Order,
} from '../lib/api';
import { ProductModal } from '../components/ProductModal';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useOfflineQueue, type QueuedOrder } from '../hooks/useOfflineQueue';

type PaymentMethod = 'CASH' | 'CARD' | 'VOUCHER' | 'OTHER';

interface CartLine {
  productId: string;
  variantId?: string;
  qty: number;
  modifiers?: { modifierId: string; priceDelta: string }[];
  name: string;
  variantName?: string;
  unitPrice: number;
  mwstRate: number;
  lineGross: number;
}

export function PosPage() {
  const { t, i18n } = useTranslation();
  const { user, token, kasseId, clearSession } = usePos();

  // Catalog
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [modalProduct, setModalProduct] = useState<Product | null>(null);

  // Shift
  const [shift, setShift] = useState<Shift | null>(null);
  const [openingFloat, setOpeningFloat] = useState('100');
  const [closingCount, setClosingCount] = useState('0');
  const [shiftLoading, setShiftLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cart
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<'IM_HAUS' | 'AUSSER_HAUS'>('IM_HAUS');

  // Checkout
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [checkout, setCheckout] = useState<'idle' | 'processing' | 'done' | 'queued'>('idle');
  const [receipt, setReceipt] = useState<Order | null>(null);

  // Offline
  const isOnline = useOnlineStatus();

  const processQueuedOrder = useCallback(
    async (qo: QueuedOrder) => {
      if (!token) throw new Error('No token');
      const order = await createOrder(
        {
          kasseId: qo.kasseId,
          shiftId: qo.shiftId,
          mode: qo.mode,
          items: qo.items,
          payments: qo.payments,
        },
        token,
      );
      await finalizeOrder(order.id, token);
    },
    [token],
  );

  const { queue, enqueue, syncing, sync } = useOfflineQueue(isOnline, processQueuedOrder);

  // Load products
  const loadProducts = useCallback(async () => {
    if (!token) return;
    try {
      const data = await fetchProducts(token);
      setProducts(data.filter((p) => p.isActive));
    } catch {
      // ignore
    }
  }, [token]);

  // Load open shift
  const loadShift = useCallback(async () => {
    if (!token || !kasseId) return;
    try {
      const shifts = await fetchShifts(kasseId, token);
      const open = shifts.find((s) => !s.closedAt);
      if (open) setShift(open);
    } catch {
      // ignore
    }
  }, [token, kasseId]);

  useEffect(() => {
    loadProducts();
    loadShift();
  }, [loadProducts, loadShift]);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const totalGross = cart.reduce((s, l) => s + l.lineGross, 0);
  const totalNet = cart.reduce((s, l) => {
    const net = l.lineGross / (1 + l.mwstRate / 100);
    return s + net;
  }, 0);
  const totalMwst = totalGross - totalNet;

  function openProductModal(product: Product) {
    if (product.variants?.length || product.modifiers?.length) {
      setModalProduct(product);
    } else {
      addToCartDirect(product);
    }
  }

  function addToCartDirect(product: Product) {
    const price = parseFloat(product.basePrice ?? '0');
    const mwst = parseFloat(mode === 'IM_HAUS' ? product.mwstImHaus : product.mwstAusserHaus);
    const existing = cart.find((l) => l.productId === product.id && !l.variantId);
    if (existing) {
      updateQty(product.id, undefined, existing.qty + 1);
    } else {
      setCart((prev) => [
        ...prev,
        {
          productId: product.id,
          variantId: undefined,
          qty: 1,
          name: product.name,
          unitPrice: price,
          mwstRate: mwst,
          lineGross: price,
        },
      ]);
    }
  }

  function addToCartFromModal(selection: {
    variantId?: string;
    modifiers: { modifierId: string; priceDelta: string }[];
    unitPrice: number;
    mwstRate: number;
  }) {
    if (!modalProduct) return;
    const variant = modalProduct.variants?.find((v) => v.id === selection.variantId);
    const line: CartLine = {
      productId: modalProduct.id,
      variantId: selection.variantId,
      qty: 1,
      modifiers: selection.modifiers,
      name: modalProduct.name,
      variantName: variant?.name,
      unitPrice: selection.unitPrice,
      mwstRate: selection.mwstRate,
      lineGross: selection.unitPrice,
    };
    setCart((prev) => [...prev, line]);
    setModalProduct(null);
  }

  function updateQty(productId: string, variantId: string | undefined, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => {
          if (l.productId === productId && l.variantId === variantId) {
            const newQty = Math.max(0, qty);
            return { ...l, qty: newQty, lineGross: l.unitPrice * newQty };
          }
          return l;
        })
        .filter((l) => l.qty > 0),
    );
  }

  function removeLine(productId: string, variantId: string | undefined) {
    setCart((prev) => prev.filter((l) => !(l.productId === productId && l.variantId === variantId)));
  }

  function clearCart() {
    setCart([]);
    setCheckout('idle');
    setReceipt(null);
  }

  async function handleOpenShift() {
    if (!kasseId || !token) return;
    setShiftLoading(true);
    setError(null);
    try {
      const s = await openShift(kasseId, parseFloat(openingFloat) || 0, token);
      setShift(s);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to open shift');
    } finally {
      setShiftLoading(false);
    }
  }

  async function handleCloseShift() {
    if (!shift || !token) return;
    setShiftLoading(true);
    setError(null);
    try {
      await closeShift(shift.id, parseFloat(closingCount) || 0, token);
      setShift(null);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to close shift');
    } finally {
      setShiftLoading(false);
    }
  }

  async function handleCheckout() {
    if (!kasseId || !shift || !token || cart.length === 0) return;

    // If offline, enqueue
    if (!isOnline) {
      const qo: QueuedOrder = {
        clientEventId: crypto.randomUUID(),
        kasseId,
        shiftId: shift.id,
        mode,
        items: cart.map((l) => ({
          productId: l.productId,
          variantId: l.variantId,
          qty: l.qty,
          modifiers: l.modifiers,
        })),
        payments: [{ method: paymentMethod, amount: totalGross.toFixed(2) }],
        createdAt: new Date().toISOString(),
      };
      enqueue(qo);
      setCheckout('queued');
      setCart([]);
      return;
    }

    setCheckout('processing');
    setError(null);
    try {
      const order = await createOrder(
        {
          kasseId,
          shiftId: shift.id,
          mode,
          items: cart.map((l) => ({
            productId: l.productId,
            variantId: l.variantId,
            qty: l.qty,
            modifiers: l.modifiers,
          })),
          payments: [{ method: paymentMethod, amount: totalGross.toFixed(2) }],
        },
        token,
      );
      const finalized = await finalizeOrder(order.id, token);
      setReceipt(finalized);
      setCheckout('done');
      setCart([]);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Checkout failed');
      setCheckout('idle');
    }
  }

  const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';

  // Receipt screen
  if (checkout === 'done' && receipt) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full">
          <h1 className="text-2xl font-bold text-center mb-4">gelato-core</h1>
          <div className="text-center text-green-400 text-lg font-semibold mb-4">
            ✓ {t('checkout.success')}
          </div>
          <div className="space-y-1 text-sm mb-4">
            <div className="flex justify-between">
              <span>Order:</span>
              <span className="font-mono">{receipt.id.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t('pos.total')}</span>
              <span className="font-bold">{fmt(Number(receipt.totalGross))}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>MwSt</span>
              <span>{fmt(Number(receipt.totalMwst))}</span>
            </div>
            <div className="flex justify-between text-gray-400">
              <span>Net</span>
              <span>{fmt(Number(receipt.totalNet))}</span>
            </div>
            {receipt.receipt?.qrPayload && (
              <div className="mt-4 pt-4 border-t border-gray-600 text-center">
                <div className="text-xs text-gray-400 mb-1">TSE</div>
                <div className="font-mono text-xs break-all">{receipt.receipt.qrPayload}</div>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              setCheckout('idle');
              setReceipt(null);
            }}
            className="w-full bg-primary hover:bg-primary-dark py-3 rounded font-semibold"
          >
            {t('checkout.newSale')}
          </button>
        </div>
      </div>
    );
  }

  // Queued (offline) confirmation
  if (checkout === 'queued') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6">
        <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full text-center">
          <div className="text-yellow-400 text-4xl mb-4">📱</div>
          <h1 className="text-xl font-bold mb-2">{t('offline.queued')}</h1>
          <p className="text-gray-400 mb-6">{t('offline.queuedDesc')}</p>
          <button
            onClick={() => setCheckout('idle')}
            className="w-full bg-primary hover:bg-primary-dark py-3 rounded font-semibold"
          >
            {t('checkout.newSale')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col">
      {/* Header */}
      <header className="bg-gray-800 p-4 flex items-center justify-between">
        <div className="font-bold text-xl">gelato-core Kasse</div>
        <div className="flex items-center gap-4">
          {/* Online/offline indicator */}
          <div className="flex items-center gap-2">
            {isOnline ? (
              <span className="text-green-400 text-sm">● {t('sync.online')}</span>
            ) : (
              <span className="text-yellow-400 text-sm">○ {t('sync.offline')}</span>
            )}
            {queue.length > 0 && (
              <span className="bg-yellow-600 text-xs px-2 py-0.5 rounded-full">
                {queue.length} {t('sync.pending')}
              </span>
            )}
            {queue.length > 0 && isOnline && (
              <button
                onClick={sync}
                disabled={syncing}
                className="text-xs bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded disabled:opacity-50"
              >
                {syncing ? '...' : t('sync.syncNow')}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {(['de', 'en', 'pt'] as const).map((lng) => (
              <button
                key={lng}
                onClick={() => i18n.changeLanguage(lng)}
                className={`text-xs px-2 py-1 rounded ${i18n.language === lng ? 'bg-gray-600' : 'hover:bg-gray-700'}`}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="text-sm text-gray-300">{user?.name}</div>
          <button onClick={clearSession} className="text-sm underline">
            {t('common.logout')}
          </button>
        </div>
      </header>

      {/* Shift panel */}
      <div className="px-6 py-3 flex items-center gap-4 border-b border-gray-700 bg-gray-850">
        {shift ? (
          <>
            <span className="text-green-400 font-semibold">
              ● {t('shift.open')}: {new Date(shift.openedAt).toLocaleTimeString()}
            </span>
            <span className="text-gray-400">{t('shift.float')}: {fmt(shift.openingFloat)}</span>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="number"
                value={closingCount}
                onChange={(e) => setClosingCount(e.target.value)}
                className="bg-gray-700 px-3 py-1 rounded text-sm w-28"
                placeholder="Count"
              />
              <button
                onClick={handleCloseShift}
                disabled={shiftLoading}
                className="bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded font-semibold text-sm disabled:opacity-50"
              >
                {t('shift.close')}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-yellow-400 font-semibold">○ {t('shift.closed')}</span>
            <div className="ml-auto flex items-center gap-2">
              <input
                type="number"
                value={openingFloat}
                onChange={(e) => setOpeningFloat(e.target.value)}
                className="bg-gray-700 px-3 py-1 rounded text-sm w-28"
                placeholder="Float"
              />
              <button
                onClick={handleOpenShift}
                disabled={shiftLoading}
                className="bg-green-600 hover:bg-green-700 px-4 py-1.5 rounded font-semibold text-sm disabled:opacity-50"
              >
                {t('shift.open')}
              </button>
            </div>
          </>
        )}
        {error && <span className="text-red-400 text-sm">{error}</span>}
      </div>

      <main className="flex-1 flex overflow-hidden">
        {/* Product catalog */}
        <section className="flex-1 p-4 overflow-y-auto">
          <input
            type="text"
            placeholder={t('pos.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full mb-4 bg-gray-800 text-white px-4 py-2 rounded border border-gray-600 focus:border-primary"
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => openProductModal(p)}
                disabled={!shift}
                className="bg-gray-800 hover:bg-gray-700 disabled:opacity-40 rounded-lg p-4 text-center transition"
              >
                <div className="text-3xl mb-2">🍨</div>
                <div className="font-semibold text-sm">{p.name}</div>
                {(p.variants?.length ?? 0) > 0 && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {(p.variants ?? []).length} {t('pos.variants')}
                  </div>
                )}
                <div className="text-primary text-lg font-bold mt-1">
                  {fmt(parseFloat(p.basePrice ?? '0'))}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="col-span-full text-gray-500 text-center py-8">
                {products.length === 0 ? t('pos.noProducts') : t('pos.noResults')}
              </div>
            )}
          </div>
        </section>

        {/* Cart sidebar */}
        <aside className="w-96 bg-gray-800 flex flex-col border-l border-gray-700">
          <div className="p-4 flex gap-2">
            <button
              onClick={() => setMode('IM_HAUS')}
              className={`flex-1 py-2 rounded font-semibold ${mode === 'IM_HAUS' ? 'bg-primary' : 'bg-gray-700'}`}
            >
              {t('pos.saloon')}
            </button>
            <button
              onClick={() => setMode('AUSSER_HAUS')}
              className={`flex-1 py-2 rounded font-semibold ${mode === 'AUSSER_HAUS' ? 'bg-primary' : 'bg-gray-700'}`}
            >
              {t('pos.takeaway')}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4">
            {cart.length === 0 ? (
              <p className="text-gray-500 text-center py-8">{t('pos.emptyCart')}</p>
            ) : (
              cart.map((line) => (
                <div
                  key={`${line.productId}-${line.variantId ?? ''}`}
                  className="flex items-center gap-2 py-2 border-b border-gray-700"
                >
                  <div className="flex-1">
                    <div className="text-sm font-semibold">
                      {line.name}
                      {line.variantName && (
                        <span className="text-gray-400"> · {line.variantName}</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {fmt(line.unitPrice)} · MwSt {line.mwstRate.toFixed(0)}%
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => updateQty(line.productId, line.variantId, line.qty - 1)}
                      className="bg-gray-700 w-7 h-7 rounded font-bold"
                    >
                      −
                    </button>
                    <span className="w-8 text-center">{line.qty}</span>
                    <button
                      onClick={() => updateQty(line.productId, line.variantId, line.qty + 1)}
                      className="bg-gray-700 w-7 h-7 rounded font-bold"
                    >
                      +
                    </button>
                  </div>
                  <div className="w-16 text-right text-sm font-semibold">
                    {fmt(line.lineGross)}
                  </div>
                  <button
                    onClick={() => removeLine(line.productId, line.variantId)}
                    className="text-red-400 text-sm"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          {cart.length > 0 && (
            <div className="p-4 border-t border-gray-700 space-y-3">
              <div className="flex justify-between text-sm text-gray-400">
                <span>Net</span>
                <span>{fmt(totalNet)}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-400">
                <span>MwSt</span>
                <span>{fmt(totalMwst)}</span>
              </div>
              <div className="flex justify-between text-xl font-bold">
                <span>{t('pos.total')}</span>
                <span>{fmt(totalGross)}</span>
              </div>

              <div className="flex gap-2">
                {(['CASH', 'CARD'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setPaymentMethod(m)}
                    className={`flex-1 py-2 rounded text-sm font-semibold ${
                      paymentMethod === m ? 'bg-primary' : 'bg-gray-700'
                    }`}
                  >
                    {m === 'CASH' ? '💵 Bar' : '💳 Karte'}
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={clearCart}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 py-3 rounded font-semibold"
                >
                  {t('pos.clear')}
                </button>
                <button
                  onClick={handleCheckout}
                  disabled={checkout === 'processing' || !shift}
                  className="flex-1 bg-green-600 hover:bg-green-700 py-3 rounded font-bold disabled:opacity-50"
                >
                  {checkout === 'processing'
                    ? '...'
                    : isOnline
                      ? t('pos.pay')
                      : t('offline.queue')}
                </button>
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* Product modal */}
      {modalProduct && (
        <ProductModal
          product={modalProduct}
          mode={mode}
          onConfirm={addToCartFromModal}
          onClose={() => setModalProduct(null)}
        />
      )}
    </div>
  );
}