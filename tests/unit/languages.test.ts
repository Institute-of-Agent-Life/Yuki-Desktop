import i18next from 'i18next'
import { expect, it } from 'vitest'
import { problemText } from '../../src/renderer/queries/client'
import { displayLanguage, listNames, systemLanguage } from '../../src/shared/locales'

// Failure cases, written before the mapping:
// - a Traditional Chinese region or script (TW/HK/MO/Hant) shows Simplified or English;
// - a Simplified Chinese region or script (CN/SG/Hans) shows Traditional or English;
// - another Chinese variant falls to English instead of Traditional Chinese;
// - a non-Chinese system shows Chinese;
// - only a later preferred language decides, or POSIX spellings (zh_CN.UTF-8) are not understood;
// - an explicit choice is overridden by the system.
it.each([
  [['zh-TW'], 'zh-Hant'],
  [['zh-HK'], 'zh-Hant'],
  [['zh-MO'], 'zh-Hant'],
  [['zh-Hant'], 'zh-Hant'],
  [['zh-Hant-US'], 'zh-Hant'],
  [['zh-Hant-CN'], 'zh-Hant'],
  [['zh-CN'], 'zh-Hans'],
  [['zh-SG'], 'zh-Hans'],
  [['zh-Hans'], 'zh-Hans'],
  [['zh-Hans-US'], 'zh-Hans'],
  [['zh-Hans-HK'], 'zh-Hans'],
  [['zh_CN.UTF-8'], 'zh-Hans'],
  [['zh'], 'zh-Hant'],
  [['zh-MY'], 'zh-Hant'],
  [['en-US', 'zh-Hans-US'], 'en'],
  [['ja-JP', 'zh-TW'], 'en'],
  [['fr'], 'en'],
  [[], 'en'],
] as const)('maps the system languages %j to %s', (preferred, language) => {
  expect(systemLanguage(preferred)).toBe(language)
})

it('keeps an explicit choice regardless of the system', () => {
  expect(displayLanguage('en', ['zh-TW'])).toBe('en')
  expect(displayLanguage('zh-Hans', ['en-US'])).toBe('zh-Hans')
  expect(displayLanguage('zh-Hant', ['zh-CN'])).toBe('zh-Hant')
  expect(displayLanguage('system', ['zh-CN'])).toBe('zh-Hans')
})

// Failure cases, written before the code:
// - the quit dialog joins several Yuki names with 「和」 in Chinese instead of the 「、」 it had;
// - English names are not joined as a natural list ("A and B", "A, B, and C").
it.each([
  ['zh-Hant', ['雪', '晴'], '雪、晴'],
  ['zh-Hant', ['雪', '晴', '雨'], '雪、晴、雨'],
  ['zh-Hans', ['雪', '晴', '雨'], '雪、晴、雨'],
  ['en', ['Yuki'], 'Yuki'],
  ['en', ['Yuki', 'Haru'], 'Yuki and Haru'],
  ['en', ['Yuki', 'Haru', 'Ame'], 'Yuki, Haru, and Ame'],
] as const)('lists names in %s', (language, names, listed) => {
  expect(listNames(language, names)).toBe(listed)
})

// Failure cases, written before the code:
// - `operation_unavailable` (the server cannot write its settings) shows the generic
//   「操作未完成（operation_unavailable）」 in any language;
// - the text does not follow the interface language.
it.each([
  ['zh-Hant', /伺服器目前無法寫入設定.*部署目錄/],
  ['zh-Hans', /服务器目前无法写入设置.*部署目录/],
  ['en', /server can't save settings.*deployment directory/i],
] as const)('explains operation_unavailable in %s', async (language, text) => {
  await i18next.changeLanguage(language)
  expect(problemText('operation_unavailable')).toMatch(text)
})
