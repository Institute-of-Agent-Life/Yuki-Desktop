import type { DisplayTimeZone } from './desktop'
import type { Language } from './locales'

/** The heading a date falls under: today, this week, or its month in the interface language. */
export function dateGroup(
  value: number | string,
  zone: DisplayTimeZone,
  locale: Language,
  labels: { today: string; thisWeek: string },
) {
  const timeZone = zone === 'system' ? undefined : zone
  const date = new Date(typeof value === 'number' ? value * 1000 : value)
  const key = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone })
  const today = key(new Date()),
    day = key(date)
  if (day === today) return labels.today
  const monday = new Date(today + 'T00:00:00Z')
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  if (day >= monday.toISOString().slice(0, 10) && day < today) return labels.thisWeek
  return date.toLocaleDateString(locale, { timeZone, year: 'numeric', month: 'long' })
}
export function formatDateTime(
  value: number | string,
  zone: DisplayTimeZone,
  locale: Language,
  options: Intl.DateTimeFormatOptions = {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
) {
  return new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString(locale, {
    ...options,
    timeZone: zone === 'system' ? undefined : zone,
  })
}
