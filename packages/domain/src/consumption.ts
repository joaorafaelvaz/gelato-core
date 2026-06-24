/**
 * Modo de consumo — afeta a alíquota de MwSt (im_haus = consumo no local /
 * Vor-Ort; ausser_haus = viagem / Mitnahme). É escolhido por pedido.
 */
export const CONSUMPTION_MODES = ['im_haus', 'ausser_haus'] as const
export type ConsumptionMode = (typeof CONSUMPTION_MODES)[number]
