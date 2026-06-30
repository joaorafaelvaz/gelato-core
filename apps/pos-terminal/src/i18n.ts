import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import de from './locales/de/translation.json';
import en from './locales/en/translation.json';
import pt from './locales/pt/translation.json';

const resources = {
  de: { translation: de },
  en: { translation: en },
  pt: { translation: pt },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'de',
  fallbackLng: 'de',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
