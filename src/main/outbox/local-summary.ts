import type { Outbox } from './index'

export function localSummary(box: Outbox) {
  const exists = (table: string) =>
    !!box.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  const count = (table: string, condition: string) =>
    exists(table)
      ? (
          box.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${condition}`).get() as {
            n: number
          }
        ).n
      : 0
  let drafts =
    Number(box.draft().length > 0) +
    count('work_drafts', 'length(text)>0') +
    count('work_question_drafts', 'length(text)>0')
  const soulSaves = exists('soul_commands')
    ? (
        box.db.prepare("SELECT command FROM soul_commands WHERE state!='result'").all() as {
          command: string
        }[]
      ).map((row) => JSON.parse(row.command) as { kind: string; content?: string })
    : []
  if (exists('soul_draft'))
    for (const row of box.db.prepare('SELECT value FROM soul_draft').all() as {
      value: string
    }[]) {
      const value = JSON.parse(row.value) as { draft: string; baseContent: string }
      if (
        value.draft !== value.baseContent &&
        !soulSaves.some((command) => command.kind === 'save' && command.content === value.draft)
      )
        drafts++
    }
  drafts += count(
    'avatar_commands',
    "state='result' AND problem IS NOT NULL AND NOT EXISTS(SELECT 1 FROM avatar_command_acknowledgements ack WHERE ack.request_id=avatar_commands.request_id)",
  )
  const pending = [
    'requests',
    'work_commands',
    'computer_commands',
    'character_commands',
    'avatar_commands',
    'soul_commands',
    'link_code_commands',
    'executor_commands',
  ].reduce((total, table) => total + count(table, "state NOT IN ('result','draft')"), 0)
  drafts += count('requests', "state='draft'") + count('work_commands', "state='draft'")
  return {
    drafts,
    pending: pending + count('local_executor_operations', '1'),
    attachments: count('uploads', 'active=1'),
  }
}
