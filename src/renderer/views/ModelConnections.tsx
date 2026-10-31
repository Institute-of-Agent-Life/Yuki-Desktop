import { useState, type ReactNode } from 'react'
import type { ModelBundle, ModelProfile } from '../../shared/models'
import { Button, Sheet, TextField } from '../components/Controls'
import { SettingsSection } from './SettingsRow'
import { ModelConnectionForm, type ConnectionDraft } from './ModelConnectionForm'
import { ModelSchemaFields, modelLabel, schemaDefaults, type JsonSchema } from './ModelSchemaFields'
import styles from './ModelSettings.module.css'
import { ModelDraftProbes, ModelTest } from './ModelProbes'
import { modelSlug, newKeyAlias, modelTaskLabel, type ModelSave } from './model-document'

type Bundle = Extract<ModelBundle, { valid: true }>

function references(data: Bundle, id: string) {
  const document = data.document,
    profile = document.profiles[id]!,
    resolved = data.resolved_profiles?.[id]
  const used = Object.entries(document.routes)
    .filter(([, value]) => value === id)
    .map(([task]) => modelTaskLabel(task))
  if (document.search_connection === id) used.push('聯網搜尋')
  for (const [otherId, other] of Object.entries(document.profiles))
    if (other.search_connection === id) used.push(`${otherId} 搜尋`)
  for (const [field, title] of [
    ['embedding', '記憶向量'],
    ['vision', '圖片理解'],
    ['asr', '語音轉文字'],
  ] as const) {
    const connection = document[field]
    if (
      connection &&
      connection.base_url === (resolved?.base_url ?? profile.base_url) &&
      connection.model === (resolved?.model ?? profile.model) &&
      connection.api_key_env === profile.api_key_env
    )
      used.push(title)
  }
  return used
}

export function ModelConnections({
  data,
  busy,
  pending,
  save,
  feedback,
  characterId,
}: {
  data: Bundle
  busy: boolean
  pending: boolean
  save: ModelSave
  feedback: ReactNode
  characterId: string
}) {
  const schema = data.profile_schema as JsonSchema
  const [adding, setAdding] = useState(false)
  const [preset, setPreset] = useState<number>()
  const [draft, setDraft] = useState<ConnectionDraft>({
    name: '',
    baseUrl: '',
    key: '',
    models: [],
  })
  const [defaults, setDefaults] = useState<Record<string, unknown>>({})
  const [editing, setEditing] = useState<{ id: string; profile: ModelProfile }>()
  const [key, setKey] = useState('')
  const [deleting, setDeleting] = useState<string[]>()
  const groups = new Map<string, [string, ModelProfile][]>()
  for (const entry of Object.entries(data.document.profiles)) {
    const [id, profile] = entry,
      address = data.resolved_profiles?.[id]?.base_url ?? profile.base_url
    const group = JSON.stringify([profile.provider, profile.protocol, address, profile.api_key_env])
    const entries = groups.get(group) ?? []
    entries.push(entry)
    groups.set(group, entries)
  }
  const extraFields = Object.keys(schema.properties!).filter(
    (name) =>
      !['id', 'headers', 'provider', 'protocol', 'base_url', 'api_key_env', 'model'].includes(name),
  )
  const add = () => {
    const selected = data.provider_presets[preset!]!,
      document = structuredClone(data.document)
    const alias = draft.key ? newKeyAlias(document, draft.name) : ''
    for (const model of draft.models) {
      const base = `${modelSlug(draft.name)}-${modelSlug(model)}`
      let id = base,
        suffix = 2
      while (id in document.profiles) id = `${base}-${suffix++}`
      document.profiles[id] = {
        ...defaults,
        provider: selected.provider,
        protocol: selected.protocol,
        base_url: draft.baseUrl,
        api_key_env: alias,
        model,
      }
    }
    save(document, draft.key ? { [alias]: draft.key } : undefined, () => {
      setDraft({ name: '', baseUrl: '', key: '', models: [] })
      setAdding(false)
    })
  }
  return (
    <>
      <SettingsSection title="模型連接">
        <div className={styles.sectionActions}>
          <Button
            onClick={() => {
              setPreset(undefined)
              setAdding(true)
            }}
            disabled={busy || pending}
          >
            新增連接
          </Button>
        </div>
      </SettingsSection>
      {[...groups.entries()].map(([group, entries]) => {
        const [firstId, first] = entries[0]!,
          address = data.resolved_profiles?.[firstId]?.base_url ?? first.base_url ?? ''
        const title =
          (
            data.provider_presets.find(
              (preset) =>
                preset.provider === first.provider &&
                preset.protocol === first.protocol &&
                preset.default_base_url === address,
            ) ??
            data.provider_presets.find(
              (preset) =>
                preset.provider === first.provider &&
                preset.protocol === first.protocol &&
                preset.default_base_url === '',
            ) ??
            data.provider_presets.find(
              (preset) => preset.provider === first.provider && preset.protocol === first.protocol,
            )
          )?.display_name ?? first.provider!
        const used = [...new Set(entries.flatMap(([id]) => references(data, id)))]
        return (
          <section className={styles.card} key={group} aria-label={title}>
            <header className={styles.cardHeader}>
              <div>
                <h3>{title}</h3>
                <small>
                  {address} · {first.protocol}
                </small>
              </div>
              <div className={styles.cardActions}>
                <span>
                  {entries.some(([id]) => data.saved_api_key_profiles.includes(id))
                    ? '已儲存'
                    : !first.api_key_env
                      ? '無需金鑰'
                      : '來自環境變數'}
                </span>
                <Button
                  aria-label={`刪除連接 ${title}`}
                  title={used.length ? `仍被「${used.join('、')}」使用` : undefined}
                  disabled={busy || pending || used.length > 0}
                  onClick={() => setDeleting(entries.map(([id]) => id))}
                >
                  刪除連接
                </Button>
              </div>
            </header>
            {entries.map(([id, profile]) => {
              const used = references(data, id)
              return (
                <div className={styles.profileRow} key={id}>
                  <div className={styles.profileLabel}>
                    <strong>{id}</strong>
                    <span>{data.resolved_profiles?.[id]?.model ?? profile.model}</span>
                    <small>{profile.capabilities?.map(modelLabel).join(' · ')}</small>
                  </div>
                  <div className={styles.cardActions}>
                    <ModelTest
                      key={JSON.stringify([profile, data.resolved_profiles?.[id]])}
                      characterId={characterId}
                      input={{ profile_id: id }}
                      disabled={busy || pending}
                    />
                    <Button
                      aria-label={`編輯 ${id}`}
                      disabled={busy || pending}
                      onClick={() => {
                        setKey('')
                        setEditing({ id, profile: structuredClone(profile) })
                      }}
                    >
                      編輯
                    </Button>
                    <Button
                      aria-label={`刪除 ${id}`}
                      title={used.length ? `仍被「${used.join('、')}」使用` : undefined}
                      disabled={busy || pending || used.length > 0}
                      onClick={() => setDeleting([id])}
                    >
                      刪除
                    </Button>
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
      <Sheet
        title="新增連接"
        open={adding}
        width={640}
        onClose={() => {
          if (!busy && !pending) setAdding(false)
        }}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setAdding(false)}>
              取消
            </Button>
            {preset !== undefined && (
              <Button variant="primary" loading={busy} onClick={add}>
                儲存
              </Button>
            )}
          </>
        }
      >
        {feedback}
        {preset === undefined ? (
          <div className={styles.presets}>
            {data.provider_presets.map((preset, index) => (
              <Button
                key={index}
                onClick={() => {
                  setPreset(index)
                  setDraft({
                    name: preset.display_name,
                    baseUrl: preset.default_base_url,
                    key: '',
                    models: [],
                  })
                  setDefaults(schemaDefaults(schema))
                }}
              >
                {preset.display_name}
              </Button>
            ))}
          </div>
        ) : (
          <>
            <Button variant="plain" disabled={busy || pending} onClick={() => setPreset(undefined)}>
              更換預設
            </Button>
            <p>{data.provider_presets[preset]!.protocol}</p>
            <fieldset className={styles.editor} disabled={busy || pending}>
              <ModelConnectionForm
                value={draft}
                change={setDraft}
                actions={
                  <ModelDraftProbes
                    characterId={characterId}
                    preset={data.provider_presets[preset]!}
                    draft={draft}
                    defaults={defaults}
                    change={setDraft}
                    disabled={busy || pending}
                  />
                }
              >
                <details className={styles.advanced} open>
                  <summary>進階</summary>
                  <ModelSchemaFields
                    schema={schema}
                    value={defaults}
                    change={setDefaults}
                    fields={extraFields}
                  />
                </details>
              </ModelConnectionForm>
            </fieldset>
            <Button
              variant="plain"
              onClick={() =>
                void window.yuki.client.external(data.provider_presets[preset]!.docs_url)
              }
            >
              服務說明
            </Button>
          </>
        )}
      </Sheet>
      <Sheet
        title="編輯模型"
        open={!!editing}
        width={640}
        onClose={() => {
          if (!busy && !pending) setEditing(undefined)
        }}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setEditing(undefined)}>
              取消
            </Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => {
                const document = structuredClone(data.document),
                  profile = { ...editing!.profile }
                const alias = profile.api_key_env || newKeyAlias(document, editing!.id)
                if (key) profile.api_key_env = alias
                document.profiles[editing!.id] = profile
                save(document, key ? { [alias]: key } : undefined, () => {
                  setKey('')
                  setEditing(undefined)
                })
              }}
            >
              儲存
            </Button>
          </>
        }
      >
        {feedback}
        {editing && (
          <fieldset className={styles.editor} disabled={busy || pending}>
            <p>{editing.id}</p>
            <label className={styles.formField}>
              金鑰
              <TextField
                type="password"
                autoComplete="off"
                value={key}
                placeholder="留空保留原金鑰"
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <ModelSchemaFields
              schema={schema}
              value={editing.profile as Record<string, unknown>}
              effective={data.resolved_profiles?.[editing.id]}
              fields={Object.keys(schema.properties!).filter((name) => name !== 'wire_options')}
              change={(profile) => setEditing({ ...editing, profile: profile as ModelProfile })}
            />
            <details className={styles.advanced}>
              <summary>進階</summary>
              <ModelSchemaFields
                schema={schema}
                value={editing.profile as Record<string, unknown>}
                fields={['wire_options']}
                change={(profile) => setEditing({ ...editing, profile: profile as ModelProfile })}
              />
            </details>
          </fieldset>
        )}
      </Sheet>
      <Sheet
        title="刪除模型連接"
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setDeleting(undefined)}>
              取消
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() => {
                const document = structuredClone(data.document)
                for (const id of deleting!) delete document.profiles[id]
                save(document, undefined, () => setDeleting(undefined))
              }}
            >
              刪除
            </Button>
          </>
        }
      >
        {feedback}
        <p>確定刪除 {deleting?.join('、')}？</p>
      </Sheet>
    </>
  )
}
