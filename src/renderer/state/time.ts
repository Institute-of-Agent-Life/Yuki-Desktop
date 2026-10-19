import { createContext, useContext } from 'react'
import type { DisplayTimeZone } from '../../shared/desktop'
import { dateGroup, formatDateTime } from '../../shared/time'

export const TimeZoneContext = createContext<DisplayTimeZone>('Asia/Taipei')
export function useDisplayTime() {
  const zone = useContext(TimeZoneContext)
  const timeZone = zone === 'system' ? undefined : zone
  const date = (
    value: number | string | null,
    options: Intl.DateTimeFormatOptions = {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  ) => (value === null ? '—' : formatDateTime(value, zone, options))
  return {
    zone,
    date,
    group: (value: number | string) => dateGroup(value, zone),
    dayKey: (value: string) => new Date(value).toLocaleDateString('sv-SE', { timeZone }),
    dayLabel: (value: string) => date(value, { month: 'numeric', day: 'numeric' }),
    timeLabel: (value: string) => date(value, { hour: '2-digit', minute: '2-digit' }),
  }
}
