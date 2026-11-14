import type { Chinese } from '../types'

export default {
  completed: '{{name}} · 工作完成',
  waiting: '{{name}} · 等待你回复',
  help: '{{name}} · 需要你帮忙',
  proactive: '主动发来了新消息。',
} satisfies Chinese<'notifications'>
