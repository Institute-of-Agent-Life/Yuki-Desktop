import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { ModelTestInput, ModelTestResult, ModelDiscoverResult } from '../../shared/models'
import type { components } from '../../shared/admin-contract.gen'
import { Banner, Button, TextField } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useTranslation } from '../i18n'
import source from '../../shared/locales/zh-Hant/models'
import type { ConnectionDraft } from './ModelConnectionForm'
import styles from './ModelSettings.module.css'

function errorText(t: TFunction<['models']>, category: string) {
  return Object.hasOwn(source.probeError, category)
    ? t(`models:probeError.${category as keyof typeof source.probeError}`)
    : category
}

export function ModelTest({
  characterId,
  input,
  label,
  disabled = false,
}: {
  characterId: string
  input: ModelTestInput
  label?: string
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation(['models'])
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
        {label ?? t('models:test')}
      </Button>
      {result && (
        <span role="status" aria-label={t('models:lastTest')}>
          {result.ok
            ? t('models:testOk', {
                seconds: result.latency_seconds.toLocaleString(i18n.language, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                }),
              })
            : errorText(t, result.error_category!)}
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
  const { t } = useTranslation(['models'])
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
          label={t('models:testConnection')}
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
          {t('models:fetchModels')}
        </Button>
      </div>
      {error && <Banner status="failed">{error}</Banner>}
      {discovery?.error_category && (
        <Banner status="failed">
          {discovery.error_category === 'unsupported'
            ? t('models:noModelList')
            : errorText(t, discovery.error_category)}
        </Banner>
      )}
      {discovery && !discovery.error_category && (
        <>
          <label className={styles.formField}>
            {t('models:searchModels')}
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
