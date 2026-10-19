import { expect, it } from 'vitest'
import { diffLines } from 'diff'
import { pairedDiff } from '../../src/shared/diff'

it('aligns replacement blocks without mixing line numbers or dropping unmatched lines', () => {
  const result = pairedDiff(diffLines('same\nold\nend\n', 'same\nnew\nextra\nend\n'))
  expect(result).toEqual([
    { left: 'same', right: 'same', leftNumber: 1, rightNumber: 1, changed: false },
    { left: 'old', right: 'new', leftNumber: 2, rightNumber: 2, changed: true },
    { left: null, right: 'extra', leftNumber: null, rightNumber: 3, changed: true },
    { left: 'end', right: 'end', leftNumber: 3, rightNumber: 4, changed: false },
  ])
})
it.each([
  ['', 'new\n'],
  ['old\n', ''],
  ['\n', '\n'],
  ['原文字🙂\n', '新文字🙂\n'],
])('retains the complete original and comparison lines for %j → %j', (left, right) => {
  const rows = pairedDiff(diffLines(left, right))
  const original = (value: string) => (value.endsWith('\n') ? value.slice(0, -1) : value)
  expect(rows.flatMap((row) => (row.left === null ? [] : [row.left])).join('\n')).toBe(
    original(left),
  )
  expect(rows.flatMap((row) => (row.right === null ? [] : [row.right])).join('\n')).toBe(
    original(right),
  )
})
