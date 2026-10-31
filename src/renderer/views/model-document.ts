import type { ModelBundle, ModelDocument } from '../../shared/models'

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
  chat_agent: '對話與工作',
  memory_extraction: '記憶擷取',
  memory_self_reflection: '記憶反思',
  memory_dream: '記憶整理',
  plugin_agent_session: '插件會話',
  utility_structured: '結構化處理',
  web_search: '聯網搜尋',
}
export const modelTaskLabel = (task: string) => tasks[task] ?? task

export function modelProfileLabel(data: Extract<ModelBundle, { valid: true }>, id: string) {
  const profile = data.document.profiles[id]!,
    resolved = data.resolved_profiles?.[id],
    name = String(resolved?.model ?? profile.model),
    address = resolved?.base_url ?? profile.base_url,
    presets = data.provider_presets.filter(
      (preset) => preset.provider === profile.provider && preset.protocol === profile.protocol,
    ),
    provider =
      (presets.find((preset) => preset.default_base_url === address) ?? presets[0])?.display_name ??
      profile.provider!,
    peers = Object.entries(data.document.profiles).filter(
      ([otherId, other]) =>
        String(data.resolved_profiles?.[otherId]?.model ?? other.model) === name &&
        other.provider === profile.provider,
    ),
    detail = [provider]
  if (peers.some(([, other]) => other.protocol !== profile.protocol)) detail.push(profile.protocol!)
  if (
    peers.some(([, other]) => other.default_max_output_tokens !== profile.default_max_output_tokens)
  ) {
    const tokens = profile.default_max_output_tokens
    if (tokens !== undefined) detail.push(`輸出 ${tokens.toLocaleString()} tokens`)
  }
  if (
    peers.filter(
      ([, other]) =>
        other.protocol === profile.protocol &&
        other.default_max_output_tokens === profile.default_max_output_tokens,
    ).length > 1
  ) {
    const uses = Object.entries(data.document.routes)
      .filter(([, value]) => value === id)
      .map(([task]) => modelTaskLabel(task))
    detail.push(...uses)
  }
  return { name, detail: detail.join(' · ') }
}
