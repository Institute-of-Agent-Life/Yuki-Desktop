import { createContext, useContext } from 'react'
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
    dayKey: (value: string) => new Date(value).toLocaleDateString('sv-SE', { timeZone }),
    dayLabel: (value: string) => date(value, { month: 'numeric', day: 'numeric' }),
    timeLabel: (value: string) => date(value, { hour: '2-digit', minute: '2-digit' }),
  }
}
