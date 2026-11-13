import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { i18nOptions, type Language } from '../shared/locales'

// Views import their translation hook from here, so i18next is ready before any of them renders.
void i18next.use(initReactI18next).init(i18nOptions('zh-Hant'))

export { useTranslation } from 'react-i18next'
export { t } from 'i18next'

/** The language Main reports at boot and broadcasts on every switch; `:lang()` picks the glyphs. */
export function applyLanguage(language: Language) {
  void i18next.changeLanguage(language)
  document.documentElement.lang = language
}
