import type { CharacterStatus } from './api'
export function characterPresence(
  connection: 'connecting' | 'online' | 'offline',
  facts?: CharacterStatus,
) {
  if (connection !== 'online')
    return { color: 'offline' as const, text: connection === 'connecting' ? '連線中' : '離線' }
  if (facts?.environment.help_requested)
    return { color: 'waiting' as const, text: '需要你協助電腦' }
  const waiting = facts?.mine.works.waiting_user ?? 0
  if (waiting) return { color: 'waiting' as const, text: `${waiting} 項工作等你回覆` }
  const running = facts?.mine.works.running ?? 0
  if (running) return { color: 'running' as const, text: `正在處理 ${running} 項工作` }
  if (facts?.mine.live_conversations.length) return { color: 'running' as const, text: '正在處理' }
  return { color: 'done' as const, text: '已連線' }
}
