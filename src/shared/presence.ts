import type { Work } from './api'
export function characterPresence(
  connection: 'connecting' | 'online' | 'offline',
  works: Work[] = [],
) {
  if (connection !== 'online')
    return { color: 'offline' as const, text: connection === 'connecting' ? '連線中' : '離線' }
  const waiting = works.filter((work) => work.state === 'waiting_user').length
  if (waiting) return { color: 'waiting' as const, text: `${waiting} 項工作等你回覆` }
  const running = works.filter((work) => work.state === 'running').length
  if (running) return { color: 'running' as const, text: `正在處理 ${running} 項工作` }
  return { color: 'done' as const, text: '已連線' }
}
