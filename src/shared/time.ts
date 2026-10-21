export function dateGroup(value: number | string, zone: 'Asia/Taipei' | 'system' = 'Asia/Taipei') {
  const timeZone = zone === 'system' ? undefined : zone
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  const key = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone })
  const today = key(new Date()),
    day = key(date)
  if (day === today) return '今天'
  const monday = new Date(today + 'T00:00:00Z')
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  if (day >= monday.toISOString().slice(0, 10) && day < today) return '本週'
  return date.toLocaleDateString(undefined, { timeZone, year: 'numeric', month: 'long' })
}
export function formatDateTime(
  value: number | string,
  zone: 'Asia/Taipei' | 'system' = 'Asia/Taipei',
  options: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
) {
  return new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString(undefined, {
    ...options,
    timeZone: zone === 'system' ? undefined : zone,
  })
}
