import type { ModelDocument } from '../../shared/models'

export type ModelSave = (
  document: ModelDocument,
  keys?: Record<string, string>,
  saved?: () => void,
) => void
export const modelSlug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9_.-]/g, (character) =>
      character.codePointAt(0)! > 127 ? `u${character.codePointAt(0)!.toString(16)}` : '-',
    )
    .replace(/^-+|-+$/g, '')

export function newKeyAlias(document: ModelDocument, name: string) {
  const aliases = new Set([
    ...Object.values(document.profiles).map((profile) => profile.api_key_env),
    ...Object.values(document.semantic_observation?.connections ?? {}).map(
      (connection) => connection.api_key_env,
    ),
    document.embedding?.api_key_env,
    document.vision?.api_key_env,
    document.asr?.api_key_env,
    document.search?.tavily_api_key_env,
  ])
  const base = `YUKI_KEY_${modelSlug(name)
    .replace(/[^a-z0-9_]/g, '_')
    .toUpperCase()}`
  let alias = base,
    suffix = 2
  while (aliases.has(alias)) alias = `${base}_${suffix++}`
  return alias
}

const tasks: Record<string, string> = {
  chat_agent: '對話',
  memory_extraction: '記憶擷取',
  memory_self_reflection: '記憶反思',
  memory_dream: '記憶整理',
  plugin_agent_session: '外部 Agent',
  utility_structured: '結構化處理',
}
export const modelTaskLabel = (task: string) => tasks[task] ?? task
