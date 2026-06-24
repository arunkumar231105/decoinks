import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import zh from './zh.json'

const STORAGE_KEY = 'decoinks-portal-lang'

const savedLang = localStorage.getItem(STORAGE_KEY) ?? 'en'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    lng:             savedLang,
    fallbackLng:     'en',
    interpolation: {
      escapeValue: false,   // React already escapes
    },
  })

// Persist language choice on every change
i18n.on('languageChanged', (lang) => {
  localStorage.setItem(STORAGE_KEY, lang)
})

export default i18n
