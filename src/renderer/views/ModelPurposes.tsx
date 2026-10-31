import { useState, type ReactNode } from 'react'
import type { components } from '../../shared/admin-contract.gen'
import type { ModelBundle, ModelDocument } from '../../shared/models'
import { Button, Segmented, Sheet, TextField } from '../components/Controls'
import { Row, SettingsSection } from './SettingsRow'
import { ModelSchemaFields, schemaDefaults, type JsonSchema } from './ModelSchemaFields'
import { modelProfileLabel, modelTaskLabel, newKeyAlias, type ModelSave } from './model-document'
import styles from './ModelSettings.module.css'

type Bundle = Extract<ModelBundle, { valid: true }>
type Semantic = components['schemas']['SemanticConnection']
const searchModes: Record<components['schemas']['WebMode'], string> = {
  disabled: '停用',
  native: '原生搜尋預設',
  tavily: '網頁工具預設',
  both: '原生與網頁工具',
}

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
    const label = modelProfileLabel(data, id)
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
    if (!document[kind]) return '沿用既有設定'
    const alias =
      kind === 'search' ? document.search?.tavily_api_key_env : document[kind]?.api_key_env
    return data.saved_connection_keys.includes(kind)
      ? '已儲存'
      : alias
        ? '來自環境變數'
        : '無需金鑰'
  }
  const semanticProviders = data.semantic_providers
  return (
    <>
      <SettingsSection title="模型用途">
        {data.tasks.map((task) => (
          <Row key={task} title={modelTaskLabel(task)}>
            <select
              aria-label={modelTaskLabel(task)}
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
      <SettingsSection title="聯網搜尋">
        <Row title="搜尋模式" description="各模型的明確搜尋方式仍按原設定執行。">
          <select
            aria-label="搜尋模式"
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
            <option value="legacy">沿用伺服器既有設定</option>
            {Object.entries(searchModes).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Row>
        <Row title="網頁工具來源">
          <Segmented
            label="網頁工具來源"
            kind="radio"
            value={searchBackend}
            items={[
              { value: 'model', label: '模型搜尋' },
              { value: 'tavily', label: 'Tavily' },
            ]}
            onChange={(search_backend) =>
              patch({ search_backend: search_backend as 'model' | 'tavily' })
            }
            disabled={locked}
          />
        </Row>
        {searchBackend === 'model' ? (
          <Row title="搜尋連接">
            <select
              aria-label="搜尋連接"
              value={document.search_connection ?? ''}
              disabled={locked}
              onChange={(event) => patch({ search_connection: event.target.value || null })}
            >
              <option value="">沿用模型的搜尋設定</option>
              {choices('search').map(([id]) => (
                <option key={id} value={id}>
                  {profileName(id)}
                </option>
              ))}
            </select>
          </Row>
        ) : (
          <Row title="Tavily 金鑰" description={keyState('search')}>
            <TextField
              type="password"
              autoComplete="off"
              aria-label="Tavily 金鑰"
              value={tavilyKey}
              disabled={locked}
              placeholder="留空保留原金鑰"
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
              aria-label="儲存 Tavily 金鑰"
            >
              儲存
            </Button>
          </Row>
        )}
      </SettingsSection>
      <SettingsSection title="參與判斷">
        <Row title="判斷連接">
          <select
            aria-label="判斷連接"
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
            <option value="">未選擇</option>
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
            新增判斷連接
          </Button>
        </Row>
        {Object.entries(document.semantic_observation?.connections ?? {}).map(
          ([id, connection]) => (
            <Row
              key={id}
              title={id}
              description={`${connection.provider} · ${connection.request_model} · ${data.saved_semantic_keys.includes(id) ? '已儲存' : '來自環境變數'}`}
            >
              <Button
                disabled={locked}
                onClick={() => {
                  setSemanticKey('')
                  setSemantic({ id, originalId: id, connection: { ...connection } })
                }}
              >
                編輯
              </Button>
            </Row>
          ),
        )}
      </SettingsSection>
      <SettingsSection title="其他用途">
        <Row
          title="記憶向量"
          description={
            document.embedding?.enabled === false
              ? '不使用'
              : document.embedding
                ? `${document.embedding.provider} · ${document.embedding.model} · ${keyState('embedding')}`
                : '沿用既有設定'
          }
        >
          <select
            aria-label="記憶向量"
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
              {document.embedding?.enabled === false ? '設定並啟用' : '目前設定'}
            </option>
            <option value="none">不使用</option>
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
            設定記憶向量
          </Button>
        </Row>
        {(['vision', 'asr'] as const).map((kind) => (
          <Row
            key={kind}
            title={kind === 'vision' ? '圖片理解' : '語音轉文字'}
            description={`${document[kind]?.model ?? '沿用既有設定'} · ${keyState(kind)}`}
          >
            <select
              aria-label={kind === 'vision' ? '圖片理解' : '語音轉文字'}
              value={currentAux(kind)}
              disabled={locked}
              onChange={(event) => auxiliary(kind, event.target.value)}
            >
              <option value="current" disabled>
                沿用目前設定
              </option>
              <option value="none">不使用</option>
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
        title={confirmEmbedding ? '更換記憶向量' : '記憶向量'}
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
              {confirmEmbedding ? '返回' : '取消'}
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
              {confirmEmbedding ? '確認更換' : '儲存'}
            </Button>
          </>
        }
      >
        {feedback}
        {confirmEmbedding ? (
          <p>
            更換後會建立新的向量索引並重新計算所有記憶的向量，期間語義搜尋會暫時只用關鍵字。舊索引保留，不會刪除。
          </p>
        ) : (
          embedding && (
            <fieldset className={styles.editor} disabled={locked}>
              <div className={styles.formFields}>
                <label className={styles.formField}>
                  向量服務預設
                  <select
                    aria-label="向量服務預設"
                    value={embeddingPreset}
                    onChange={(event) => {
                      setEmbeddingPreset(event.target.value)
                      const selected = presets[Number(event.target.value)]!
                      setEmbedding({ ...embedding, ...selected.embedding_defaults })
                    }}
                  >
                    <option value="" disabled>
                      {embedding.provider ? `目前：${embedding.provider}` : '選擇服務預設'}
                    </option>
                    {presets.map((preset, index) => (
                      <option key={index} value={index}>
                        {preset.display_name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.formField}>
                  金鑰
                  <TextField
                    type="password"
                    autoComplete="off"
                    value={embeddingKey}
                    onChange={(event) => setEmbeddingKey(event.target.value)}
                    placeholder="留空保留原金鑰"
                  />
                </label>
                <ModelSchemaFields
                  schema={embeddingSchema}
                  value={embedding}
                  change={setEmbedding}
                  fields={['base_url', 'model', 'dimensions']}
                />
                <details className={styles.advanced}>
                  <summary>進階</summary>
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
        title="參與判斷連接"
        open={!!semantic}
        width={600}
        onClose={() => {
          if (!locked) setSemantic(undefined)
        }}
        actions={
          <>
            <Button disabled={locked} onClick={() => setSemantic(undefined)}>
              取消
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
              儲存
            </Button>
          </>
        }
      >
        {feedback}
        {semantic && (
          <fieldset className={styles.editor} disabled={locked}>
            <div className={styles.formFields}>
              <label className={styles.formField}>
                連接 ID
                <TextField
                  value={semantic.id}
                  onChange={(event) => setSemantic({ ...semantic, id: event.target.value })}
                />
              </label>
              <label className={styles.formField}>
                Provider
                <select
                  aria-label="Provider"
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
                  label =
                    field === 'endpoint'
                      ? '服務位址'
                      : field === 'api_key_env'
                        ? '金鑰環境變數'
                        : field === 'request_model'
                          ? '請求模型'
                          : field === 'response_model'
                            ? '回應模型'
                            : '逾時（秒）'
                return (
                  <label className={styles.formField} key={field}>
                    {label}
                    {required && <small>必填</small>}
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
                金鑰
                <TextField
                  type="password"
                  autoComplete="off"
                  value={semanticKey}
                  onChange={(event) => setSemanticKey(event.target.value)}
                  placeholder="留空保留原金鑰"
                />
              </label>
            </div>
          </fieldset>
        )}
      </Sheet>
    </>
  )
}
