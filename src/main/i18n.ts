import i18next from 'i18next'
import { i18nOptions, type Language } from '../shared/locales'

// Main's strings (menus, tray, notifications, dialogs) read the current language when built.
void i18next.init(i18nOptions('zh-Hant'))

export { t } from 'i18next'
export const language = () => i18next.language as Language
export function setLanguage(language: Language) {
  void i18next.changeLanguage(language)
}
