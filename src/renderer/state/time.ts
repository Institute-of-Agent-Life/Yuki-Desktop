import { createContext, useContext, useMemo } from 'react'
import type { DisplayTimeZone } from '../../shared/desktop'
import type { Language } from '../../shared/locales'
import { dateGroup, formatDateTime } from '../../shared/time'
import { useTranslation } from '../i18n'

export const TimeZoneContext = createContext<DisplayTimeZone>('Asia/Taipei')
/** Times in the chosen zone, formatted in the interface language; a language switch re-renders. */
export function useDisplayTime() {
  const zone = useContext(TimeZoneContext)
  const { t, i18n } = useTranslation(['time'])
  const locale = i18n.language as Language
  const timeZone = zone === 'system' ? undefined : zone
  // One formatter for every day: made for each message, the conversation spent most of a render
  // making them.
  const day = useMemo(() => new Intl.DateTimeFormat('sv-SE', { timeZone }), [timeZone])
  const date = (
    value: number | string | null,
    options: Intl.DateTimeFormatOptions = {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  ) => (value === null ? '—' : formatDateTime(value, zone, locale, options))
  return {
    zone,
    locale,
    date,
    group: (value: number | string) =>
      dateGroup(value, zone, locale, { today: t('time:today'), thisWeek: t('time:thisWeek') }),
    dayKey: (value: string) => day.format(new Date(value)),
    dayLabel: (value: string) => date(value, { month: 'numeric', day: 'numeric' }),
    timeLabel: (value: string) => date(value, { hour: '2-digit', minute: '2-digit' }),
  }
}
