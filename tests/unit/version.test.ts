import { expect, it } from 'vitest'
import { meetsMinimum } from '../../src/shared/version'
it.each([
  ['1.0.0-beta.1', '1.0.0', false],
  ['1.0.0', '1.0.0-beta.1', true],
  ['1.0.0-beta.10', '1.0.0-beta.2', true],
  ['1.0.0-beta.1', '1.0.0-beta.1', true],
  ['1.1.0', '1.0.99', true],
  ['1.0.0', '2.0.0', false],
  ['1.0.0+build.1', '1.0.0', true],
  ['invalid', '1.0.0', null],
  ['1.0.0', '1.0.0-beta.01', null],
  ['1.0.0+build..1', '1.0.0', null],
] as const)('compares %s with server minimum %s', (actual, minimum, expected) =>
  expect(meetsMinimum(actual, minimum)).toBe(expected),
)
