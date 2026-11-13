import type { English } from '../types'

export default {
  completed: '{{name}} · Work completed',
  waiting: '{{name}} · Waiting for your reply',
  help: '{{name}} · Needs your help',
  proactive: 'Sent you a new message.',
} satisfies English<'notifications'>
