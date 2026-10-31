import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Connection } from '../../shared/api'
import type { ModelApplyInput, ModelDocument } from '../../shared/models'
import { Banner, Button, Segmented, Spinner } from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
import { PendingRequest, SettingsSection } from './SettingsRow'
import styles from './ModelSettings.module.css'

export function useModelConfiguration(id: string) {
  const cache = useQueryClient()
  const key = ['desktop', 'models', id]
  const bundle = useQuery({
    queryKey: key,
    queryFn: () => window.yuki.client.models.read(id).then(unwrap),
    retry: false,
  })
  const [pending, setPending] = useState<{ input: ModelApplyInput; saved?(): void }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const run = async (request: NonNullable<typeof pending>) => {
    setBusy(true)
    setError('')
    setConflict(false)
    try {
      const result = unwrap(await window.yuki.client.models.apply(id, request.input))
      setPending(undefined)
      if (result.success) {
        request.saved?.()
        await cache.invalidateQueries({ queryKey: key })
      } else setError('設定未能套用，請檢查目前設定。')
    } catch (failure) {
      if (failure instanceof ClientProblem && failure.code === 'version_conflict') {
        setPending(undefined)
        setConflict(true)
      } else {
        setError((failure as Error).message)
        if (
          failure instanceof ClientProblem &&
          !['transport_unknown', 'unknown'].includes(failure.code)
        )
          setPending(undefined)
        if (failure instanceof ClientProblem && failure.code === 'capability_denied')
          await cache.invalidateQueries({ queryKey: key })
      }
    } finally {
      setBusy(false)
    }
  }
  const save = (document: ModelDocument, apiKeys?: Record<string, string>, saved?: () => void) => {
    const request = {
      input: {
        requestId: crypto.randomUUID(),
        expectedRevision: bundle.data!.revision,
        document,
        apiKeys,
      },
      saved,
    }
    setPending(request)
    void run(request)
  }
  return { bundle, save, busy, error, conflict, pending, verify: () => void run(pending!) }
}

export function ModelSettings({ connection }: { connection: Connection }) {
  const model = useModelConfiguration(connection.characterId)
  const [tab, setTab] = useState('connections')
  const data = model.bundle.data
  if (
    model.bundle.error instanceof ClientProblem &&
    model.bundle.error.code === 'capability_denied'
  )
    return <Banner>只有 Yuki 的管理員可以修改模型設定</Banner>
  if (model.bundle.isPending) return <Spinner />
  if (model.bundle.error) return <Banner status="failed">{model.bundle.error.message}</Banner>
  if (!data!.valid)
    return <Banner status="failed">Yuki 上的模型設定檔無法解析，請由管理員檢查</Banner>
  return (
    <div className={styles.settings}>
      <div className={styles.toolbar}>
        <Segmented
          label="模型頁面"
          value={tab}
          items={[
            { value: 'connections', label: '連接' },
            { value: 'purposes', label: '用途' },
            { value: 'usage', label: '用量' },
          ]}
          onChange={setTab}
        />
        <small>
          {data!.apply_mode === 'hot_reload' ? '儲存後立即生效' : '儲存後需重新啟動 Yuki'}
        </small>
      </div>
      {model.error && <Banner status="failed">{model.error}</Banner>}
      {model.conflict && (
        <Banner status="failed">
          設定已在其他地方變更 <Button onClick={() => void model.bundle.refetch()}>重新載入</Button>
        </Banner>
      )}
      {model.pending && !model.busy && (
        <PendingRequest text="模型設定等待確認" busy={model.busy} onVerify={model.verify} />
      )}
      <SettingsSection
        title={tab === 'connections' ? '模型連接' : tab === 'purposes' ? '模型用途' : '模型用量'}
      >
        <p className={styles.notice}>
          {tab === 'connections'
            ? `${Object.keys(data!.document.profiles).length} 個模型`
            : tab === 'purposes'
              ? '選擇每項用途使用的模型。'
              : '按用途與模型查看實際用量。'}
        </p>
      </SettingsSection>
    </div>
  )
}
