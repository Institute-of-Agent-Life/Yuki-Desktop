import { expect, it } from 'vitest'
import { parsePairing } from '../../src/shared/pairing'
const code = 'Qm3x-9vT_2LhW8aZpK4rN7cYd1sEfGb0'
it.each([
  code,
  `綁定碼：${code}（10 分鐘有效）`,
  `yuki://pair?server=https%3A%2F%2Ftest.example%2Fmika&code=${code}`,
])('preserves the exact complete pairing token in %s', (input) =>
  expect(parsePairing(input)?.code).toBe(code),
)
it.each([
  'A'.repeat(33),
  'A'.repeat(64),
  `yuki://pair?server=https://test.example&code=${'A'.repeat(33)}`,
  `yuki://pair?code=invalid\n${code}`,
])('rejects a longer token or invalid link without falling back: %s', (input) =>
  expect(parsePairing(input)).toBeNull(),
)
