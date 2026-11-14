import type { TFunction } from 'i18next'
import type { CharacterStatus } from './api'

export function characterPresence(
  t: TFunction<['presence']>,
  connection: 'connecting' | 'online' | 'offline',
  facts?: CharacterStatus,
) {
  if (connection !== 'online')
    return {
      color: 'offline' as const,
      text: t(connection === 'connecting' ? 'presence:connecting' : 'presence:offline'),
    }
  if (facts?.environment.help_requested)
    return { color: 'waiting' as const, text: t('presence:help') }
  const waiting = facts?.mine.works.waiting_user ?? 0
  if (waiting) return { color: 'waiting' as const, text: t('presence:waiting', { count: waiting }) }
  const running = facts?.mine.works.running ?? 0
  if (running) return { color: 'running' as const, text: t('presence:running', { count: running }) }
  if (facts?.mine.live_conversations.length)
    return { color: 'running' as const, text: t('presence:busy') }
  return { color: 'done' as const, text: t('presence:online') }
}
