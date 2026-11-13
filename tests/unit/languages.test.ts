import { expect, it } from 'vitest'
import { displayLanguage, systemLanguage } from '../../src/shared/locales'

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
