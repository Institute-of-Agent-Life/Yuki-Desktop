import { useState, type ReactNode } from 'react'
import type { TFunction } from 'i18next'
import type { ModelBundle, ModelProfile } from '../../shared/models'
import { Button, Sheet, TextField } from '../components/Controls'
import { useTranslation } from '../i18n'
import { Row, SettingsSection } from './SettingsRow'
import { ModelConnectionForm, type ConnectionDraft } from './ModelConnectionForm'
import { ModelSchemaFields, schemaDefaults, type JsonSchema } from './ModelSchemaFields'
import styles from './ModelSettings.module.css'
import { ModelDraftProbes, ModelTest } from './ModelProbes'
import {
  modelProfileLabel,
  modelSlug,
  newKeyAlias,
  modelTaskLabel,
  type ModelSave,
} from './model-document'

type Bundle = Extract<ModelBundle, { valid: true }>

function references(t: TFunction<['models']>, data: Bundle, id: string) {
  const document = data.document,
    profile = document.profiles[id]!,
    resolved = data.resolved_profiles?.[id]
  const used = Object.entries(document.routes)
    .filter(([, value]) => value === id)
    .map(([task]) => modelTaskLabel(t, task))
  if (document.search_connection === id) used.push(t('models:task.web_search'))
  for (const [otherId, other] of Object.entries(document.profiles))
    if (other.search_connection === id) used.push(t('models:use.searchOf', { id: otherId }))
  for (const field of ['embedding', 'vision', 'asr'] as const) {
    const connection = document[field]
    if (
      connection &&
      connection.base_url === (resolved?.base_url ?? profile.base_url) &&
      connection.model === (resolved?.model ?? profile.model) &&
      connection.api_key_env === profile.api_key_env
    )
      used.push(t(`models:use.${field}`))
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
  const { t, i18n } = useTranslation(['models', 'common'])
  const schema = data.profile_schema as JsonSchema
  const profileLabel = (id: string) => modelProfileLabel(t, i18n.language, data, id)
  const usedBy = (used: string[]) =>
    used.length ? t('models:usedBy', { uses: used.join(t('models:listSeparator')) }) : undefined
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
      <SettingsSection title={t('models:connections')}>
        <Row title={t('models:connectService')} description={t('models:connectServiceDescription')}>
          <Button
            onClick={() => {
              setPreset(undefined)
              setAdding(true)
            }}
            disabled={busy || pending}
          >
            {t('models:addConnection')}
          </Button>
        </Row>
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
        const used = [...new Set(entries.flatMap(([id]) => references(t, data, id)))]
        return (
          <section className={styles.card} key={group} aria-label={title}>
            <header className={styles.cardHeader}>
              <div>
                <h3>{title}</h3>
                <small>{address}</small>
              </div>
              <div className={styles.cardActions}>
                <span>
                  {t(
                    entries.some(([id]) => data.saved_api_key_profiles.includes(id))
                      ? 'models:keyState.saved'
                      : !first.api_key_env
                        ? 'models:keyState.none'
                        : 'models:keyState.env',
                  )}
                </span>
                <Button
                  aria-label={t('models:deleteConnectionOf', { title })}
                  title={usedBy(used)}
                  disabled={busy || pending || used.length > 0}
                  onClick={() => setDeleting(entries.map(([id]) => id))}
                >
                  {t('models:deleteConnection')}
                </Button>
              </div>
            </header>
            {entries.map(([id, profile]) => {
              const used = references(t, data, id),
                label = profileLabel(id)
              return (
                <div className={styles.profileRow} key={id}>
                  <div className={styles.profileLabel}>
                    <strong>{label.name}</strong>
                    <small>{label.detail}</small>
                  </div>
                  <div className={styles.cardActions}>
                    <ModelTest
                      key={JSON.stringify([profile, data.resolved_profiles?.[id]])}
                      characterId={characterId}
                      input={{ profile_id: id }}
                      disabled={busy || pending}
                    />
                    <Button
                      aria-label={t('models:editProfileOf', label)}
                      disabled={busy || pending}
                      onClick={() => {
                        setKey('')
                        setEditing({ id, profile: structuredClone(profile) })
                      }}
                    >
                      {t('models:edit')}
                    </Button>
                    <Button
                      aria-label={t('models:deleteProfileOf', label)}
                      title={usedBy(used)}
                      disabled={busy || pending || used.length > 0}
                      onClick={() => setDeleting([id])}
                    >
                      {t('models:delete')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </section>
        )
      })}
      <Sheet
        title={t('models:addConnection')}
        open={adding}
        width={640}
        onClose={() => {
          if (!busy && !pending) setAdding(false)
        }}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setAdding(false)}>
              {t('common:action.cancel')}
            </Button>
            {preset !== undefined && (
              <Button variant="primary" loading={busy} onClick={add}>
                {t('common:action.save')}
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
              {t('models:changePreset')}
            </Button>
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
                <details className={styles.advanced}>
                  <summary>{t('models:advanced')}</summary>
                  <p>
                    {t('models:apiProtocol', {
                      protocol: data.provider_presets[preset]!.protocol,
                    })}
                  </p>
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
              {t('models:serviceDocs')}
            </Button>
          </>
        )}
      </Sheet>
      <Sheet
        title={t('models:editModel')}
        open={!!editing}
        width={640}
        onClose={() => {
          if (!busy && !pending) setEditing(undefined)
        }}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setEditing(undefined)}>
              {t('common:action.cancel')}
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
              {t('common:action.save')}
            </Button>
          </>
        }
      >
        {feedback}
        {editing && (
          <fieldset className={`${styles.editor} ${styles.formFields}`} disabled={busy || pending}>
            <label className={styles.formField}>
              {t('models:key')}
              <TextField
                type="password"
                autoComplete="off"
                value={key}
                placeholder={t('models:keyKeep')}
                onChange={(event) => setKey(event.target.value)}
              />
            </label>
            <ModelSchemaFields
              schema={schema}
              value={editing.profile as Record<string, unknown>}
              effective={data.resolved_profiles?.[editing.id]}
              fields={['base_url', 'model']}
              change={(profile) => setEditing({ ...editing, profile: profile as ModelProfile })}
            />
            <details className={styles.advanced}>
              <summary>{t('models:advanced')}</summary>
              <p>
                {t('models:profileId')}
                <code>{editing.id}</code>
              </p>
              <ModelSchemaFields
                schema={schema}
                value={editing.profile as Record<string, unknown>}
                effective={data.resolved_profiles?.[editing.id]}
                fields={Object.keys(schema.properties!).filter(
                  (name) => !['base_url', 'model'].includes(name),
                )}
                change={(profile) => setEditing({ ...editing, profile: profile as ModelProfile })}
              />
            </details>
          </fieldset>
        )}
      </Sheet>
      <Sheet
        title={t('models:deleteConnections')}
        open={!!deleting}
        onClose={() => setDeleting(undefined)}
        actions={
          <>
            <Button disabled={busy || pending} onClick={() => setDeleting(undefined)}>
              {t('common:action.cancel')}
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
              {t('models:delete')}
            </Button>
          </>
        }
      >
        {feedback}
        {deleting && (
          <p>
            {t('models:confirmDelete', {
              names: deleting
                .map((id) => {
                  const label = profileLabel(id)
                  return `${label.name} · ${label.detail}`
                })
                .join(t('models:listSeparator')),
            })}
          </p>
        )}
      </Sheet>
    </>
  )
}
