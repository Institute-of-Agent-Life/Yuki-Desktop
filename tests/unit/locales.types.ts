/**
 * Checked by `npm run typecheck`: every `@ts-expect-error` below must stay an error, or tsc fails
 * with an unused directive. Failure cases, written before the resource types:
 * - a Simplified or English namespace misses a key of the Traditional source;
 * - a translation adds a key the source does not have;
 * - a whole namespace is missing from a language;
 * - English lacks the `_one` form of a counted key;
 * - `t()` accepts an unknown namespace or key, or interpolation with a misspelled value.
 */
import { t } from 'i18next'
import zhHans from '../../src/shared/locales/zh-Hans'
import en from '../../src/shared/locales/en'
import type { Chinese, English, Translation } from '../../src/shared/locales/types'

const simplifiedWithoutKey: Omit<typeof zhHans.tray, 'open'> = zhHans.tray
const englishWithoutKey: Omit<typeof en.tray, 'open'> = en.tray
const withoutNamespace: Omit<typeof zhHans, 'tray'> = zhHans
const englishWithoutOne: Omit<typeof en.settings, 'exportRecords_one'> = en.settings

// @ts-expect-error A Simplified namespace without one of the source keys
export const missingSimplified = simplifiedWithoutKey satisfies Chinese<'tray'>
// @ts-expect-error An English namespace without one of the source keys
export const missingEnglish = englishWithoutKey satisfies English<'tray'>
// @ts-expect-error A key the source does not have
export const extraKey = { ...zhHans.tray, unknown: '' } satisfies Chinese<'tray'>
// @ts-expect-error A language without one of the source namespaces
export const missingNamespace = withoutNamespace satisfies Translation<'zh-Hans'>
// @ts-expect-error English without the singular form of a counted key
export const missingOne = englishWithoutOne satisfies English<'settings'>
export const chineseOne = {
  ...zhHans.settings,
  // @ts-expect-error Chinese has no singular form
  exportRecords_one: '',
} satisfies Chinese<'settings'>

export const complete = [
  zhHans satisfies Translation<'zh-Hans'>,
  en satisfies Translation<'en'>,
  t('menu:file'),
  t('tray:open', { name: 'Yuki' }),
  t('settings:exportRecords', { count: 2 }),
]
// @ts-expect-error Unknown key
export const unknownKey = t('menu:noSuchKey')
// @ts-expect-error Unknown namespace
export const unknownNamespace = t('noSuchNamespace:file')
// @ts-expect-error Interpolation with a misspelled value
export const misspelledValue = t('tray:open', { nam: 'Yuki' })
