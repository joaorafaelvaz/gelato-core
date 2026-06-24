import de from './locales/de.json'
import en from './locales/en.json'
import pt from './locales/pt.json'

/** Locales preenchidos no Ciclo 0. IT entra depois (infra já pronta). */
export const SUPPORTED_LOCALES = ['de', 'en', 'pt'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'de'

export const resources = {
  de: { translation: de },
  en: { translation: en },
  pt: { translation: pt },
} as const

export { de, en, pt }
