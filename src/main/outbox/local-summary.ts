import type { Outbox } from './index'

const retiredTables = [
  'computer_commands',
  'avatar_commands',
  'avatar_command_acknowledgements',
  'executor_commands',
  'executor_setup',
  'local_executor_operations',
  'character_commands',
] as const

function retiredTablesPresent(box: Outbox) {
  return retiredTables.flatMap((table) => {
    if (!box.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
      return []
    const condition =
      table === 'character_commands'
        ? " WHERE json_extract(command, '$.kind') NOT IN ('profile', 'device-revoke')"
        : ''
    return [{ table, condition }]
  })
}

export function retiredSummary(box: Outbox) {
  return retiredTablesPresent(box)
    .map(({ table, condition }) => ({
      table,
      count: (
        box.db.prepare(`SELECT count(*) AS n FROM ${table}${condition}`).get() as { n: number }
      ).n,
    }))
    .filter(({ count }) => count > 0)
}

export function exportRetired(box: Outbox) {
  return (
    JSON.stringify(
      {
        owner: box.owner,
        tables: Object.fromEntries(
          retiredTablesPresent(box).map(({ table, condition }) => [
            table,
            box.db.prepare(`SELECT * FROM ${table}${condition}`).all(),
          ]),
        ),
      },
      null,
      2,
    ) + '\n'
  )
}

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
