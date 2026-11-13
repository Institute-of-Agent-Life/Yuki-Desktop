import type { InitOptions } from 'i18next'
import zhHant from './zh-Hant'
import zhHans from './zh-Hans'
import en from './en'
import type { Source } from './types'

export const languages = ['zh-Hant', 'zh-Hans', 'en'] as const
export type Language = (typeof languages)[number]
export type LanguagePreference = 'system' | Language
export const languagePreferences: readonly LanguagePreference[] = ['system', ...languages]
/** Each language names itself, whatever the interface language is. */
export const languageNames: Record<Language, string> = {
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
  en: 'English',
}

export const resources = { 'zh-Hant': zhHant, 'zh-Hans': zhHans, en }

/** TW/HK/MO or Hant → Traditional, CN/SG or Hans → Simplified, other Chinese → Traditional. */
export function systemLanguage(preferred: readonly string[]): Language {
  const [language, ...subtags] = (preferred[0] ?? '').toLowerCase().split(/[-_.@]/)
  if (language !== 'zh') return 'en'
  if (subtags.includes('hant')) return 'zh-Hant'
  if (subtags.includes('hans') || subtags.includes('cn') || subtags.includes('sg')) return 'zh-Hans'
  return 'zh-Hant'
}

export function displayLanguage(preference: LanguagePreference, preferred: readonly string[]) {
  return preference === 'system' ? systemLanguage(preferred) : preference
}

/** Main and the renderer initialize i18next alike; resources are bundled, so this is synchronous. */
export function i18nOptions(language: Language): InitOptions {
  return {
    resources,
    lng: language,
    fallbackLng: false,
    ns: Object.keys(zhHant),
    defaultNS: 'common',
    initAsync: false,
    interpolation: { escapeValue: false },
  }
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: Source
  }
}
