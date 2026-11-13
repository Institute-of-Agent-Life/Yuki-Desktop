import { useState, type ReactNode } from 'react'
import type { components } from '../../shared/admin-contract.gen'
import type { ModelBundle, ModelDocument } from '../../shared/models'
import { Button, Segmented, Sheet, TextField } from '../components/Controls'
import { useTranslation } from '../i18n'
import { Row, SettingsSection } from './SettingsRow'
import { ModelSchemaFields, schemaDefaults, type JsonSchema } from './ModelSchemaFields'
import { modelProfileLabel, modelTaskLabel, newKeyAlias, type ModelSave } from './model-document'
import styles from './ModelSettings.module.css'

type Bundle = Extract<ModelBundle, { valid: true }>
type Semantic = components['schemas']['SemanticConnection']
const searchModes: components['schemas']['WebMode'][] = ['disabled', 'native', 'tavily', 'both']

export function ModelPurposes({
  data,
  busy,
  pending,
  save,
  feedback,
}: {
  data: Bundle
  busy: boolean
  pending: boolean
  save: ModelSave
  feedback: ReactNode
}) {
  const { t, i18n } = useTranslation(['models', 'common'])
  const document = data.document,
    locked = busy || pending,
    searchBackend = document.search_backend ?? data.search_backend
  const [tavilyKey, setTavilyKey] = useState('')
  const [embedding, setEmbedding] = useState<Record<string, unknown>>()
  const [embeddingPreset, setEmbeddingPreset] = useState(''),
    [embeddingKey, setEmbeddingKey] = useState(''),
    [confirmEmbedding, setConfirmEmbedding] = useState(false)
  const [semantic, setSemantic] = useState<{
      id: string
      originalId?: string
      connection: Semantic
    }>(),
    [semanticKey, setSemanticKey] = useState('')
  const embeddingSchema = data.connection_schemas.embedding! as JsonSchema
  const presets = data.provider_presets.filter((preset) => preset.supports_embedding)
  const profiles = Object.entries(document.profiles)
  const profileName = (id: string) => {
    const label = modelProfileLabel(t, i18n.language, data, id)
    return `${label.name} · ${label.detail}`
  }
  const choices = (task: string) =>
    profiles.filter(([, profile]) =>
      data.task_requirements[task]!.every((capability) =>
        profile.capabilities?.includes(capability),
      ),
    )
  const patch = (value: Partial<ModelDocument>) => save({ ...document, ...value })
  const resolved = (id: string) => {
    const profile = document.profiles[id]!,
      effective = data.resolved_profiles?.[id]
    return {
      base_url: effective?.base_url ?? profile.base_url ?? '',
      model: effective?.model ?? profile.model ?? '',
      api_key_env: profile.api_key_env ?? '',
    }
  }
  const currentAux = (kind: 'vision' | 'asr') => {
    const value = document[kind]
    if (value?.enabled === false) return 'none'
    return (
      profiles.find(
        ([id, profile]) =>
          value &&
          profile.protocol === value.protocol &&
          Object.entries(resolved(id)).every(
            ([name, field]) => value[name as keyof typeof value] === field,
          ),
      )?.[0] ?? 'current'
    )
  }
  const auxiliary = (kind: 'vision' | 'asr', id: string) => {
    const value =
      id === 'none'
        ? {
            ...schemaDefaults(data.connection_schemas[kind]! as JsonSchema),
            ...document[kind],
            enabled: false,
          }
        : { ...resolved(id), protocol: document.profiles[id]!.protocol!, enabled: true }
    patch({ [kind]: value } as Partial<ModelDocument>)
  }
  const keyState = (kind: 'embedding' | 'vision' | 'asr' | 'search') => {
    if (!document[kind]) return t('models:keyState.inherit')
    const alias =
      kind === 'search' ? document.search?.tavily_api_key_env : document[kind]?.api_key_env
    return t(
      data.saved_connection_keys.includes(kind)
        ? 'models:keyState.saved'
        : alias
          ? 'models:keyState.env'
          : 'models:keyState.none',
    )
  }
  const semanticProviders = data.semantic_providers
  return (
    <>
      <SettingsSection title={t('models:purposes')}>
        {data.tasks.map((task) => (
          <Row key={task} title={modelTaskLabel(t, task)}>
            <select
              aria-label={modelTaskLabel(t, task)}
              value={document.routes[task]}
              disabled={locked}
              onChange={(event) =>
                patch({ routes: { ...document.routes, [task]: event.target.value } })
              }
            >
              {choices(task).map(([id]) => (
                <option key={id} value={id}>
                  {profileName(id)}
                </option>
              ))}
            </select>
          </Row>
        ))}
      </SettingsSection>
      <SettingsSection title={t('models:webSearch')}>
        <Row title={t('models:searchModeTitle')} description={t('models:searchModeDescription')}>
          <select
            aria-label={t('models:searchModeTitle')}
            value={document.search?.mode ?? 'legacy'}
            disabled={locked}
            onChange={(event) =>
              patch({
                search: {
                  ...schemaDefaults(data.connection_schemas.search! as JsonSchema),
                  ...document.search,
                  mode:
                    event.target.value === 'legacy'
                      ? null
                      : (event.target.value as components['schemas']['WebMode']),
                } as NonNullable<ModelDocument['search']>,
              })
            }
          >
            <option value="legacy">{t('models:searchModeLegacy')}</option>
            {searchModes.map((mode) => (
              <option key={mode} value={mode}>
                {t(`models:searchMode.${mode}`)}
              </option>
            ))}
          </select>
        </Row>
        <Row title={t('models:webToolSource')}>
          <Segmented
            label={t('models:webToolSource')}
            kind="radio"
            value={searchBackend}
            items={[
              { value: 'model', label: t('models:modelSearch') },
              { value: 'tavily', label: 'Tavily' },
            ]}
            onChange={(search_backend) =>
              patch({ search_backend: search_backend as 'model' | 'tavily' })
            }
            disabled={locked}
          />
        </Row>
        {searchBackend === 'model' ? (
          <Row title={t('models:searchConnection')}>
            <select
              aria-label={t('models:searchConnection')}
              value={document.search_connection ?? ''}
              disabled={locked}
              onChange={(event) => patch({ search_connection: event.target.value || null })}
            >
              <option value="">{t('models:searchConnectionInherit')}</option>
              {choices('search').map(([id]) => (
                <option key={id} value={id}>
                  {profileName(id)}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <Row title={t('models:tavilyKey')} description={keyState('search')}>
            <TextField
              type="password"
              autoComplete="off"
              aria-label={t('models:tavilyKey')}
              value={tavilyKey}
              disabled={locked}
              placeholder={t('models:keyKeep')}
              onChange={(event) => setTavilyKey(event.target.value)}
            />
            <Button
              loading={busy}
              disabled={pending}
              onClick={() => {
                const alias = document.search?.tavily_api_key_env || newKeyAlias(document, 'search')
                save(
                  { ...document, search: { ...document.search, tavily_api_key_env: alias } },
                  tavilyKey ? { [alias]: tavilyKey } : undefined,
                  () => setTavilyKey(''),
                )
              }}
              aria-label={t('models:saveTavilyKey')}
            >
              {t('common:action.save')}
            </Button>
          </Row>
        )}
      </SettingsSection>
      <SettingsSection title={t('models:semantic')}>
        <Row title={t('models:semanticRoute')}>
          <select
            aria-label={t('models:semanticRoute')}
            value={document.semantic_observation?.route ?? ''}
            disabled={locked}
            onChange={(event) =>
              patch({
                semantic_observation: {
                  ...document.semantic_observation,
                  route: event.target.value,
                },
              })
            }
          >
            <option value="">{t('models:notChosen')}</option>
            {Object.keys(document.semantic_observation?.connections ?? {}).map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
          <Button
            disabled={locked}
            onClick={() => {
              setSemanticKey('')
              setSemantic({
                id: 'semantic',
                connection: {
                  provider: semanticProviders[0]!.provider,
                  request_model: '',
                  ...(semanticProviders[0]!.default_endpoint
                    ? { endpoint: semanticProviders[0]!.default_endpoint }
                    : {}),
                  ...(semanticProviders[0]!.default_api_key_env
                    ? { api_key_env: semanticProviders[0]!.default_api_key_env }
                    : {}),
                },
              })
            }}
          >
            {t('models:addSemantic')}
          </Button>
        </Row>
        {Object.entries(document.semantic_observation?.connections ?? {}).map(
          ([id, connection]) => (
            <Row
              key={id}
              title={id}
              description={`${connection.provider} · ${connection.request_model} · ${t(data.saved_semantic_keys.includes(id) ? 'models:keyState.saved' : 'models:keyState.env')}`}
            >
              <Button
                disabled={locked}
                onClick={() => {
                  setSemanticKey('')
                  setSemantic({ id, originalId: id, connection: { ...connection } })
                }}
              >
                {t('models:edit')}
              </Button>
            </Row>
          ),
        )}
      </SettingsSection>
      <SettingsSection title={t('models:otherPurposes')}>
        <Row
          title={t('models:use.embedding')}
          description={
            document.embedding?.enabled === false
              ? t('models:notUsed')
              : document.embedding
                ? `${document.embedding.provider} · ${document.embedding.model} · ${keyState('embedding')}`
                : t('models:keyState.inherit')
          }
        >
          <select
            aria-label={t('models:use.embedding')}
            value={document.embedding?.enabled === false ? 'none' : 'current'}
            disabled={locked}
            onChange={(event) => {
              if (event.target.value === 'none')
                patch({
                  embedding: {
                    ...schemaDefaults(embeddingSchema),
                    ...document.embedding,
                    enabled: false,
                  } as ModelDocument['embedding'],
                })
              else {
                setEmbedding({
                  ...schemaDefaults(embeddingSchema),
                  ...document.embedding,
                  enabled: true,
                })
                setEmbeddingPreset('')
                setEmbeddingKey('')
                setConfirmEmbedding(false)
              }
            }}
          >
            <option value="current">
              {t(
                document.embedding?.enabled === false
                  ? 'models:configureAndEnable'
                  : 'models:currentSettings',
              )}
            </option>
            <option value="none">{t('models:notUsed')}</option>
          </select>
          <Button
            disabled={locked}
            onClick={() => {
              setEmbedding({ ...schemaDefaults(embeddingSchema), ...document.embedding })
              setEmbeddingPreset('')
              setEmbeddingKey('')
              setConfirmEmbedding(false)
            }}
          >
            {t('models:configureEmbedding')}
          </Button>
        </Row>
        {(['vision', 'asr'] as const).map((kind) => (
          <Row
            key={kind}
            title={t(`models:use.${kind}`)}
            description={`${document[kind]?.model ?? t('models:keyState.inherit')} · ${keyState(kind)}`}
          >
            <select
              aria-label={t(`models:use.${kind}`)}
              value={currentAux(kind)}
              disabled={locked}
              onChange={(event) => auxiliary(kind, event.target.value)}
            >
              <option value="current" disabled>
                {t('models:keepCurrent')}
              </option>
              <option value="none">{t('models:notUsed')}</option>
              {profiles
                .filter(
                  ([, profile]) =>
                    profile.protocol === 'chat_completions' &&
                    (kind !== 'vision' ||
                      data.task_requirements.vision!.every((capability) =>
                        profile.capabilities?.includes(capability),
                      )),
                )
                .map(([id]) => (
                  <option key={id} value={id}>
                    {profileName(id)}
                  </option>
                ))}
            </select>
          </Row>
        ))}
      </SettingsSection>
      <Sheet
        title={t(confirmEmbedding ? 'models:replaceEmbedding' : 'models:use.embedding')}
        open={!!embedding}
        width={600}
        onClose={() => {
          if (!locked) setEmbedding(undefined)
        }}
        actions={
          <>
            <Button
              disabled={locked}
              onClick={() => {
                if (confirmEmbedding) setConfirmEmbedding(false)
                else setEmbedding(undefined)
              }}
            >
              {t(confirmEmbedding ? 'common:action.back' : 'common:action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={pending}
              onClick={() => {
                if (!confirmEmbedding) {
                  setConfirmEmbedding(true)
                  return
                }
                const alias = String(
                  embedding!.api_key_env ||
                    (embeddingKey ? newKeyAlias(document, 'embedding') : ''),
                )
                save(
                  {
                    ...document,
                    embedding: {
                      ...embedding,
                      api_key_env: alias,
                      enabled: true,
                    } as ModelDocument['embedding'],
                  },
                  embeddingKey ? { [alias]: embeddingKey } : undefined,
                  () => {
                    setEmbeddingKey('')
                    setEmbedding(undefined)
                  },
                )
              }}
            >
              {t(confirmEmbedding ? 'models:confirmReplace' : 'common:action.save')}
            </Button>
          </>
        }
      >
        {feedback}
        {confirmEmbedding ? (
          <p>{t('models:replaceEmbeddingWarning')}</p>
        ) : (
          embedding && (
            <fieldset className={styles.editor} disabled={locked}>
              <div className={styles.formFields}>
                <label className={styles.formField}>
                  {t('models:embeddingPreset')}
                  <select
                    aria-label={t('models:embeddingPreset')}
                    value={embeddingPreset}
                    onChange={(event) => {
                      setEmbeddingPreset(event.target.value)
                      const selected = presets[Number(event.target.value)]!
                      setEmbedding({ ...embedding, ...selected.embedding_defaults })
                    }}
                  >
                    <option value="" disabled>
                      {embedding.provider
                        ? t('models:currentProvider', { provider: String(embedding.provider) })
                        : t('models:choosePreset')}
                    </option>
                    {presets.map((preset, index) => (
                      <option key={index} value={index}>
                        {preset.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.formField}>
                  {t('models:key')}
                  <TextField
                    type="password"
                    autoComplete="off"
                    value={embeddingKey}
                    onChange={(event) => setEmbeddingKey(event.target.value)}
                    placeholder={t('models:keyKeep')}
                  />
                </label>
                <ModelSchemaFields
                  schema={embeddingSchema}
                  value={embedding}
                  change={setEmbedding}
                  fields={['base_url', 'model', 'dimensions']}
                />
                <details className={styles.advanced}>
                  <summary>{t('models:advanced')}</summary>
                  <ModelSchemaFields
                    schema={embeddingSchema}
                    value={embedding}
                    change={setEmbedding}
                    fields={Object.keys(embeddingSchema.properties!).filter(
                      (name) =>
                        ![
                          'provider',
                          'enabled',
                          'base_url',
                          'model',
                          'dimensions',
                          'api_key_env',
                        ].includes(name),
                    )}
                  />
                </details>
              </div>
            </fieldset>
          )
        )}
      </Sheet>
      <Sheet
        title={t('models:semanticConnection')}
        open={!!semantic}
        width={600}
        onClose={() => {
          if (!locked) setSemantic(undefined)
        }}
        actions={
          <>
            <Button disabled={locked} onClick={() => setSemantic(undefined)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={pending}
              onClick={() => {
                const connections = { ...document.semantic_observation?.connections },
                  connection = { ...semantic!.connection }
                if (semanticKey && !connection.api_key_env)
                  connection.api_key_env = newKeyAlias(document, `semantic-${semantic!.id}`)
                if (semantic!.originalId) delete connections[semantic!.originalId]
                connections[semantic!.id] = connection
                save(
                  {
                    ...document,
                    semantic_observation: {
                      route:
                        semantic!.originalId &&
                        document.semantic_observation?.route === semantic!.originalId
                          ? semantic!.id
                          : (document.semantic_observation?.route ?? ''),
                      connections,
                    },
                  },
                  semanticKey ? { [connection.api_key_env!]: semanticKey } : undefined,
                  () => {
                    setSemanticKey('')
                    setSemantic(undefined)
                  },
                )
              }}
            >
              {t('common:action.save')}
            </Button>
          </>
        }
      >
        {feedback}
        {semantic && (
          <fieldset className={styles.editor} disabled={locked}>
            <div className={styles.formFields}>
              <label className={styles.formField}>
                {t('models:connectionId')}
                <TextField
                  value={semantic.id}
                  onChange={(event) => setSemantic({ ...semantic, id: event.target.value })}
                />
              </label>
              <label className={styles.formField}>
                {t('models:field.provider')}
                <select
                  aria-label={t('models:field.provider')}
                  value={semantic.connection.provider}
                  onChange={(event) => {
                    const preset = semanticProviders.find(
                      (preset) => preset.provider === event.target.value,
                    )!
                    setSemantic({
                      ...semantic,
                      connection: {
                        provider: preset.provider,
                        request_model: semantic.connection.request_model,
                        ...(preset.default_endpoint ? { endpoint: preset.default_endpoint } : {}),
                        ...(preset.default_api_key_env
                          ? { api_key_env: preset.default_api_key_env }
                          : {}),
                      },
                    })
                  }}
                >
                  {semanticProviders.map((preset) => (
                    <option key={preset.provider} value={preset.provider}>
                      {preset.provider}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  'endpoint',
                  'api_key_env',
                  'request_model',
                  'response_model',
                  'timeout_seconds',
                ] as const
              ).map((field) => {
                const required = semanticProviders
                    .find((preset) => preset.provider === semantic.connection.provider)!
                    .required.includes(field),
                  label = t(`models:field.${field}`)
                return (
                  <label className={styles.formField} key={field}>
                    {label}
                    {required && <small>{t('models:required')}</small>}
                    <TextField
                      aria-label={label}
                      type={field === 'timeout_seconds' ? 'number' : 'text'}
                      value={semantic.connection[field] ?? ''}
                      onChange={(event) => {
                        const connection = {
                          ...semantic.connection,
                          [field]:
                            field === 'timeout_seconds'
                              ? event.target.value
                                ? Number(event.target.value)
                                : undefined
                              : event.target.value,
                        }
                        if (!event.target.value && field !== 'request_model')
                          delete connection[field]
                        setSemantic({ ...semantic, connection })
                      }}
                    />
                  </label>
                )
              })}
              <label className={styles.formField}>
                {t('models:key')}
                <TextField
                  type="password"
                  autoComplete="off"
                  value={semanticKey}
                  onChange={(event) => setSemanticKey(event.target.value)}
                  placeholder={t('models:keyKeep')}
                />
              </label>
            </div>
          </fieldset>
        )}
      </Sheet>
    </>
  )
}
