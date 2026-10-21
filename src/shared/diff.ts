import type { Change } from 'diff'

export interface DiffRow {
  left: string | null
  right: string | null
  leftNumber: number | null
  rightNumber: number | null
  changed: boolean
}
export function pairedDiff(changes: Change[]): DiffRow[] {
  const result: DiffRow[] = []
  let leftNumber = 0,
    rightNumber = 0
  const lines = (value: string) => {
    const parts = value.split('\n')
    if (parts.at(-1) === '') parts.pop()
    return parts
  }
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!
    let left: string[], right: string[]
    if (change.removed && changes[index + 1]?.added) {
      left = lines(change.value)
      right = lines(changes[++index]!.value)
    } else {
      left = change.added ? [] : lines(change.value)
      right = change.removed ? [] : lines(change.value)
    }
    for (let row = 0; row < Math.max(left.length, right.length); row++)
      result.push({
        left: left[row] ?? null,
        right: right[row] ?? null,
        leftNumber: row < left.length ? ++leftNumber : null,
        rightNumber: row < right.length ? ++rightNumber : null,
        changed: !!change.added || !!change.removed,
      })
  }
  return result
}
