import { useState } from 'react'
import type { ModelTestInput, ModelTestResult, ModelDiscoverResult } from '../../shared/models'
import type { components } from '../../shared/admin-contract.gen'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap } from '../queries/client'
import type { ConnectionDraft } from './ModelConnectionForm'
import styles from './ModelSettings.module.css'

const errors: Record<string, string> = {
  authentication: '金鑰驗證失敗',
  rate_limit: '服務暫時限流',
  quota: '服務額度不足',
  timeout: '連接逾時',
  protocol: '服務回應不符合協定',
  unavailable: '服務目前無法使用',
  configuration: '請檢查連接設定',
  unsupported: '這個服務不支援此操作',
}
const errorText = (category: string) => errors[category] ?? category

export function ModelTest({
  characterId,
  input,
  label = '測試',
  disabled = false,
}: {
  characterId: string
  input: ModelTestInput
  label?: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState<ModelTestResult>(),
    [error, setError] = useState('')
  return (
    <div className={styles.probe}>
      <Button
        loading={busy}
        disabled={disabled}
        onClick={async () => {
          setBusy(true)
          setResult(undefined)
          setError('')
          try {
            setResult(unwrap(await window.yuki.client.models.test(characterId, input)))
          } catch (failure) {
            setError((failure as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {label}
      </Button>
      {result && (
        <span role="status" aria-label="上次測試結果">
          {result.ok
            ? `可用 · ${result.latency_seconds.toFixed(1)} 秒`
            : errorText(result.error_category!)}
        </span>
      )}
      {error && <Banner status="failed">{error}</Banner>}
    </div>
  )
}

export function ModelDraftProbes({
  characterId,
  preset,
  draft,
  defaults,
  change,
  disabled,
}: {
  characterId: string
  preset: components['schemas']['ProviderPresetView']
  draft: ConnectionDraft
  defaults: Record<string, unknown>
  change(value: ConnectionDraft): void
  disabled: boolean
}) {
  const [busy, setBusy] = useState(false),
    [discovery, setDiscovery] = useState<ModelDiscoverResult>(),
    [error, setError] = useState(''),
    [search, setSearch] = useState('')
  const profile = {
    ...defaults,
    id: 'draft',
    provider: preset.provider,
    protocol: preset.protocol,
    base_url: draft.baseUrl,
    api_key_env: '',
    model: draft.models[0],
  } as components['schemas']['DraftModelProfile']
  return (
    <div className={styles.formFields}>
      <div className={styles.cardActions}>
        <ModelTest
          characterId={characterId}
          input={{ draft_profile: profile, ...(draft.key ? { api_key: draft.key } : {}) }}
          label="測試連接"
          disabled={disabled || draft.models.length === 0}
        />
        <Button
          loading={busy}
          disabled={disabled}
          onClick={async () => {
            setBusy(true)
            setError('')
            setDiscovery(undefined)
            try {
              setDiscovery(
                unwrap(
                  await window.yuki.client.models.discover(characterId, {
                    draft_connection: {
                      provider: preset.provider,
                      protocol: preset.protocol,
                      base_url: draft.baseUrl,
                      api_key_env: '',
                      timeout_seconds: defaults.timeout_seconds as number,
                    },
                    ...(draft.key ? { api_key: draft.key } : {}),
                  }),
                ),
              )
            } catch (failure) {
              setError((failure as Error).message)
            } finally {
              setBusy(false)
            }
          }}
        >
          取得模型清單
        </Button>
      </div>
      {error && <Banner status="failed">{error}</Banner>}
      {discovery?.error_category && (
        <Banner status="failed">
          {discovery.error_category === 'unsupported'
            ? '這個服務不提供模型清單，請手動輸入模型 ID'
            : errorText(discovery.error_category)}
        </Banner>
      )}
      {discovery && !discovery.error_category && (
        <>
          <label className={styles.formField}>
            搜尋模型 ID
            <TextField value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          <div className={styles.modelList}>
            {discovery
              .models!.filter((model) =>
                model.id.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
              )
              .map((model) => (
                <label key={model.id}>
                  <input
                    type="checkbox"
                    aria-label={model.id}
                    checked={draft.models.includes(model.id)}
                    onChange={(event) =>
                      change({
                        ...draft,
                        models: event.target.checked
                          ? [...new Set([...draft.models, model.id])]
                          : draft.models.filter((id) => id !== model.id),
                      })
                    }
                  />
                  <span>
                    {model.id}
                    {model.display_name && <small>{model.display_name}</small>}
                  </span>
                </label>
              ))}
          </div>
        </>
      )}
    </div>
  )
}
