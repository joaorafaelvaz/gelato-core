import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Product, ProductVariant, ProductModifier } from '../lib/api';

interface ProductModalProps {
  product: Product;
  mode: 'IM_HAUS' | 'AUSSER_HAUS';
  onConfirm: (selection: {
    variantId?: string;
    modifiers: { modifierId: string; priceDelta: string }[];
    unitPrice: number;
    mwstRate: number;
  }) => void;
  onClose: () => void;
}

export function ProductModal({ product, mode, onConfirm, onClose }: ProductModalProps) {
  const { t } = useTranslation();
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<Set<string>>(new Set());

  const basePrice = parseFloat(product.basePrice ?? '0');
  const variantDelta = selectedVariant ? parseFloat(selectedVariant.priceDelta ?? '0') : 0;
  const modifiersDelta = product.modifiers
    ? product.modifiers
        .filter((m) => selectedModifiers.has(m.id))
        .reduce((sum, m) => sum + parseFloat(m.priceDelta ?? '0'), 0)
    : 0;
  const unitPrice = basePrice + variantDelta + modifiersDelta;
  const mwstRate = parseFloat(mode === 'IM_HAUS' ? product.mwstImHaus : product.mwstAusserHaus);

  function toggleModifier(id: string) {
    setSelectedModifiers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    onConfirm({
      variantId: selectedVariant?.id,
      modifiers: product.modifiers
        ? product.modifiers
            .filter((m) => selectedModifiers.has(m.id))
            .map((m) => ({ modifierId: m.id, priceDelta: m.priceDelta ?? '0' }))
        : [],
      unitPrice,
      mwstRate,
    });
  }

  const fmt = (n: number) => n.toFixed(2).replace('.', ',') + ' €';

  const groupedModifiers = (product.modifiers ?? []).reduce((acc, m) => {
    const key = m.groupKey ?? 'extras';
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {} as Record<string, ProductModifier[]>);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">{product.name}</h2>
            <span className="text-primary font-semibold">{fmt(basePrice)}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">
            ✕
          </button>
        </div>

        <div className="p-4 space-y-6">
          {/* Variants */}
          {product.variants && product.variants.length > 0 && (
            <div>
              <h3 className="font-semibold mb-2">{t('pos.variants')}</h3>
              <div className="grid grid-cols-2 gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v === selectedVariant ? null : v)}
                    className={`p-3 rounded text-left ${
                      selectedVariant?.id === v.id
                        ? 'bg-primary text-white'
                        : 'bg-gray-700 hover:bg-gray-600'
                    }`}
                  >
                    <div className="font-semibold text-sm">{v.name}</div>
                    {v.priceDelta && parseFloat(v.priceDelta) > 0 && (
                      <div className="text-xs">+{fmt(parseFloat(v.priceDelta))}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {Object.entries(groupedModifiers).map(([group, mods]) => (
            <div key={group}>
              <h3 className="font-semibold mb-2 capitalize">{group}</h3>
              <div className="space-y-2">
                {mods.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center justify-between bg-gray-700 p-3 rounded cursor-pointer hover:bg-gray-600"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedModifiers.has(m.id)}
                        onChange={() => toggleModifier(m.id)}
                        className="w-5 h-5 accent-primary"
                      />
                      <span className="text-sm">{m.name}</span>
                    </div>
                    {m.priceDelta && parseFloat(m.priceDelta) > 0 && (
                      <span className="text-sm text-gray-300">+{fmt(parseFloat(m.priceDelta))}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}

          {/* MwSt info */}
          <div className="text-xs text-gray-400">
            MwSt ({mode === 'IM_HAUS' ? t('pos.saloon') : t('pos.takeaway')}): {mwstRate.toFixed(0)}%
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex items-center justify-between">
          <div className="text-2xl font-bold">{fmt(unitPrice)}</div>
          <button
            onClick={handleConfirm}
            className="bg-green-600 hover:bg-green-700 px-8 py-3 rounded-lg font-bold"
          >
            {t('pos.addToCart')}
          </button>
        </div>
      </div>
    </div>
  );
}