function version(value: string): { core: bigint[]; pre: string[] } | null {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/.exec(
      value,
    )
  if (!match) return null
  const pre = match[4]?.split('.') ?? []
  if (pre.some((item) => !item || /^0\d+$/.test(item))) return null
  if (match[5]?.split('.').some((item) => !item)) return null
  return { core: match.slice(1, 4).map((item) => BigInt(item!)), pre }
}
export function meetsMinimum(actual: string, minimum: string): boolean | null {
  const a = version(actual),
    b = version(minimum)
  if (!a || !b) return null
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! > b.core[i]!
  if (!a.pre.length || !b.pre.length) return !a.pre.length || !!b.pre.length
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i],
      y = b.pre[i]
    if (x === y) continue
    if (x === undefined || y === undefined) return y === undefined
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y)
    return nx && ny ? BigInt(x) > BigInt(y) : nx !== ny ? !nx : x > y
  }
  return true
}
