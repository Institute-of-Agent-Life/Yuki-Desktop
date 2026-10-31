import { useQuery } from '@tanstack/react-query'
import type { ModelStatsView } from '../../shared/models'
import { Banner, Spinner } from '../components/Controls'
import { unwrap } from '../queries/client'
import styles from './ModelUsage.module.css'
import { modelTaskLabel } from './model-document'

type Stats = ModelStatsView['by_profile'][string]

const numbers = new Intl.NumberFormat('zh-Hant-TW', { maximumFractionDigits: 3 })
const count = (value: number) => numbers.format(value)

function UsageTable({
  title,
  tasks = false,
  groups,
}: {
  title: string
  tasks?: boolean
  groups: Record<string, Stats>
}) {
  const rows = Object.entries(groups)
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{tasks ? '用途' : '模型設定'}</th>
            <th scope="col">呼叫次數</th>
            <th scope="col">成功／失敗</th>
            <th scope="col">平均延遲</th>
            <th scope="col">輸入 token</th>
            <th scope="col">輸出 token</th>
            <th scope="col">快取讀取 token</th>
            <th scope="col">快取建立 token</th>
            <th scope="col">未知用量</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, value]) => (
            <tr key={id}>
              <th scope="row" title={id}>
                {tasks ? modelTaskLabel(id) : id}
              </th>
              <td>{count(value.invocations)}</td>
              <td>{`${count(value.successes)}／${count(value.failures)}`}</td>
              <td>{count(value.average_latency_seconds)} 秒</td>
              <td>{count(value.prompt_tokens)}</td>
              <td>{count(value.completion_tokens)}</td>
              <td>{count(value.cached_prompt_tokens)}</td>
              <td>{count(value.cache_creation_input_tokens)}</td>
              <td>{count(value.unknown_usage)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className={styles.empty}>
                尚無用量紀錄
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ModelUsage({ characterId }: { characterId: string }) {
  const stats = useQuery({
    queryKey: ['desktop', 'model-stats', characterId],
    queryFn: () => window.yuki.client.models.stats(characterId).then(unwrap),
    retry: false,
  })
  if (stats.error) return <Banner status="failed">{stats.error.message}</Banner>
  if (stats.isPending) return <Spinner />
  return (
    <div className={styles.usage}>
      <p className={styles.notice}>Token 僅加總已回報的用量；未回報總量的呼叫另列為未知用量。</p>
      <UsageTable title="按用途" tasks groups={stats.data!.by_task} />
      <UsageTable title="按模型" groups={stats.data!.by_profile} />
    </div>
  )
}
