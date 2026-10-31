import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import type {
  ModelStatsQuery,
  ModelStatsView,
  ModelUsageGroup,
  ModelUsageStats,
} from '../../shared/models'
import { Banner, Spinner } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { modelTaskLabel } from './model-document'
import styles from './ModelUsage.module.css'

type Field = keyof ModelUsageStats['coverage']
type GroupBy = ModelStatsView['group_by']
const exact = new Intl.NumberFormat('zh-Hant-TW', { maximumFractionDigits: 3 })
const compact = new Intl.NumberFormat('zh-Hant-TW', { maximumFractionDigits: 2 })
const percentage = new Intl.NumberFormat('zh-Hant-TW', {
  style: 'percent',
  maximumFractionDigits: 1,
})
const ranges: { value: ModelStatsQuery['range']; label: string }[] = [
  { value: 'today', label: '今日' },
  { value: '24h', label: '近 24 小時' },
  { value: '7d', label: '近 7 天' },
  { value: 'all', label: '全部留存' },
]

function quantity(value: number) {
  for (const [size, suffix] of [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const) {
    if (value >= size) return `${compact.format(value / size)} ${suffix}`
  }
  return exact.format(value)
}

function tokens(stats: ModelUsageStats, field: Field, full = false) {
  if (stats.invocations && !stats.coverage[field]) return '未知'
  return full ? exact.format(stats[field]) : quantity(stats[field])
}

function StatsDetail({ stats }: { stats: ModelUsageStats }) {
  const fields: [string, string][] = [
    ['輸入 Token', tokens(stats, 'prompt_tokens', true)],
    ['輸出 Token', tokens(stats, 'completion_tokens', true)],
    ['快取讀取', tokens(stats, 'cached_prompt_tokens', true)],
    ['快取建立', tokens(stats, 'cache_creation_input_tokens', true)],
    ['呼叫次數', exact.format(stats.invocations)],
    ['呼叫失敗', exact.format(stats.failures)],
    ['未完整回報用量', exact.format(stats.unknown_usage)],
    ['平均請求延遲', `${exact.format(stats.average_latency_seconds)} 秒`],
  ]
  return (
    <dl className={styles.detailStats}>
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function UsageGroup({
  group,
  by,
  total,
  historical = false,
}: {
  group: ModelUsageGroup
  by: GroupBy
  total: number
  historical?: boolean
}) {
  const name =
    by === 'model'
      ? group.model || '未標註模型'
      : historical
        ? group.task || '未標註用途'
        : modelTaskLabel(group.task!)
  const models = [...new Set(group.sources.map((source) => source.model))]
  const description =
    by === 'model'
      ? group.provider || '未標註供應商'
      : models.length === 1
        ? models[0] || '未標註模型'
        : `${models.length} 個模型`
  const known = group.stats.coverage.total_tokens > 0
  const share = total && known ? group.stats.total_tokens / total : null
  return (
    <details className={styles.group}>
      <summary className={styles.groupSummary}>
        <div className={styles.groupName}>
          <strong title={name}>{name}</strong>
          <span>
            {description} · {exact.format(group.stats.invocations)} 次呼叫
          </span>
          {share !== null && (
            <div className={styles.shareTrack} aria-hidden="true">
              <span style={{ width: `${share * 100}%` }} />
            </div>
          )}
        </div>
        <div className={styles.groupValue}>
          <strong title={tokens(group.stats, 'total_tokens', true)}>
            {tokens(group.stats, 'total_tokens')}
          </strong>
          <span>{share === null ? '—' : percentage.format(share)}</span>
        </div>
        <ChevronRight className={styles.chevron} size={15} aria-hidden="true" />
      </summary>
      <div className={styles.groupDetails}>
        <StatsDetail stats={group.stats} />
        <details className={styles.sources}>
          <summary>來源資料</summary>
          <ul>
            {group.sources.map((source) => (
              <li
                key={JSON.stringify([
                  source.task,
                  source.provider,
                  source.model,
                  source.profile_id,
                ])}
              >
                <span>
                  {source.model || '未標註模型'} · {source.provider || '未標註供應商'}
                </span>
                <span>
                  原用途 <code>{source.task || '未標註'}</code> · 原配置{' '}
                  <code>{source.profile_id || '未標註'}</code>
                </span>
                <span>
                  {tokens(source.stats, 'total_tokens', true)} Token ·{' '}
                  {exact.format(source.stats.invocations)} 次呼叫
                </span>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </details>
  )
}

export function ModelUsage({
  characterId,
  tasks,
}: {
  characterId: string
  tasks: readonly string[]
}) {
  const display = useDisplayTime()
  const timezone =
    display.zone === 'system' ? Intl.DateTimeFormat().resolvedOptions().timeZone : display.zone
  const [period, setPeriod] = useState<{ range: ModelStatsQuery['range']; end: string }>({
    range: 'today',
    end: new Date().toISOString(),
  })
  const [by, setBy] = useState<GroupBy>('model')
  const [filter, setFilter] = useState('')
  const [provider, model] = by === 'task' && filter ? (JSON.parse(filter) as [string, string]) : []
  const query: ModelStatsQuery = {
    ...period,
    timezone,
    group_by: by,
    ...(by === 'model' && filter ? { task: filter } : {}),
    ...(provider !== undefined && model !== undefined ? { provider, model } : {}),
  }
  const stats = useQuery({
    queryKey: ['desktop', 'model-stats', characterId, query],
    queryFn: () => window.yuki.client.models.stats(characterId, query).then(unwrap),
    retry: false,
  })
  const changeRange = (range: ModelStatsQuery['range']) => {
    setFilter('')
    setPeriod({ range, end: new Date().toISOString() })
  }
  const changeGroup = (group: GroupBy) => {
    setFilter('')
    setBy(group)
  }
  const currentTask = (task: string) => tasks.includes(task) || task === 'web_search'
  const data = stats.data
  const summary = data?.summary
  const historical =
    data?.groups.filter((group) => by === 'task' && !currentTask(group.task!)) ?? []
  const visible = data?.groups.filter((group) => by === 'model' || currentTask(group.task!)) ?? []
  const key = (group: ModelUsageGroup) => JSON.stringify([group.task, group.provider, group.model])
  return (
    <section aria-label="模型用量" className={styles.usage}>
      <header className={styles.header}>
        <div>
          <h2>用量</h2>
          <p>看看 Yuki 這段時間用了多少。</p>
        </div>
        <div className={styles.ranges} role="group" aria-label="統計時間範圍">
          {ranges.map((range) => (
            <button
              key={range.value}
              type="button"
              aria-pressed={period.range === range.value}
              onClick={() => changeRange(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>
      </header>
      {stats.error ? (
        <Banner status="failed">{stats.error.message}</Banner>
      ) : stats.isPending ? (
        <Spinner />
      ) : (
        <>
          <div className={styles.hero} aria-label="用量摘要">
            <p className={styles.eyebrow}>
              已回報 Token{' '}
              {filter && (
                <span>
                  · <span>篩選結果</span>
                </span>
              )}
            </p>
            <div className={styles.total}>
              <output aria-label="已回報 Token" title={tokens(summary!, 'total_tokens', true)}>
                {tokens(summary!, 'total_tokens')}
              </output>
              <span>Token</span>
            </div>
            <dl className={styles.metrics}>
              <div>
                <dt>輸入</dt>
                <dd title={tokens(summary!, 'prompt_tokens', true)}>
                  {tokens(summary!, 'prompt_tokens')}
                </dd>
              </div>
              <div>
                <dt>輸出</dt>
                <dd title={tokens(summary!, 'completion_tokens', true)}>
                  {tokens(summary!, 'completion_tokens')}
                </dd>
              </div>
              <div>
                <dt>呼叫</dt>
                <dd>{exact.format(summary!.invocations)} 次</dd>
              </div>
            </dl>
            <div className={styles.cache}>
              <span>快取讀取</span>
              <div className={styles.cacheTrack} aria-hidden="true">
                <span
                  style={{
                    width:
                      summary!.cache_read.ratio === null
                        ? '0%'
                        : `${summary!.cache_read.ratio * 100}%`,
                  }}
                />
              </div>
              <strong title={tokens(summary!, 'cached_prompt_tokens', true)}>
                {tokens(summary!, 'cached_prompt_tokens')}
              </strong>
              <span>
                {summary!.cache_read.ratio === null
                  ? '比例不適用'
                  : `${percentage.format(summary!.cache_read.ratio)} 的成對輸入`}
              </span>
            </div>
            {summary!.cache_read.reported_calls < summary!.invocations && (
              <p className={styles.coverage}>
                快取比例依 {exact.format(summary!.cache_read.reported_calls)}／
                {exact.format(summary!.invocations)} 次同時回報輸入與快取的呼叫計算。
              </p>
            )}
          </div>
          <div className={styles.groupBar}>
            <div className={styles.groupTabs} role="group" aria-label="用量分組">
              <button
                type="button"
                aria-pressed={by === 'model'}
                onClick={() => changeGroup('model')}
              >
                模型
              </button>
              <button
                type="button"
                aria-pressed={by === 'task'}
                onClick={() => changeGroup('task')}
              >
                用途
              </button>
            </div>
            <label className={styles.filter}>
              <span>{by === 'model' ? '用途' : '模型'}</span>
              <select
                aria-label={by === 'model' ? '篩選用途' : '篩選模型'}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="">{by === 'model' ? '全部用途' : '全部模型'}</option>
                {by === 'model'
                  ? data!.options.tasks.filter(currentTask).map((task) => (
                      <option key={task} value={task}>
                        {modelTaskLabel(task)}
                      </option>
                    ))
                  : data!.options.models.map((item) => (
                      <option
                        key={JSON.stringify([item.provider, item.model])}
                        value={JSON.stringify([item.provider, item.model])}
                      >
                        {item.model || '未標註模型'} · {item.provider || '未標註供應商'}
                      </option>
                    ))}
              </select>
            </label>
          </div>
          {summary!.invocations === 0 ? (
            <p className={styles.empty}>這段時間與篩選條件下尚無模型呼叫。</p>
          ) : (
            <div className={styles.groups}>
              <div className={styles.listCaption}>
                <span>依 Token 用量排序</span>
                <span>Token ／ 占比</span>
              </div>
              {visible.map((group) => (
                <UsageGroup key={key(group)} group={group} by={by} total={summary!.total_tokens} />
              ))}
              {historical.length > 0 && (
                <details className={styles.history}>
                  <summary>
                    <span>歷史用途</span>
                    <span>
                      {historical.some((group) => group.stats.coverage.total_tokens > 0)
                        ? quantity(
                            historical.reduce(
                              (value, group) => value + group.stats.total_tokens,
                              0,
                            ),
                          )
                        : '未知'}{' '}
                      Token
                    </span>
                    <ChevronRight className={styles.chevron} size={15} aria-hidden="true" />
                  </summary>
                  {historical.map((group) => (
                    <UsageGroup
                      key={key(group)}
                      group={group}
                      by={by}
                      total={summary!.total_tokens}
                      historical
                    />
                  ))}
                </details>
              )}
            </div>
          )}
          <footer className={styles.footer}>
            {summary!.unknown_usage > 0 && (
              <p>有 {exact.format(summary!.unknown_usage)} 次呼叫未完整回報用量，合計可能偏少。</p>
            )}
            <details>
              <summary>統計說明</summary>
              <p>
                只加總目前範圍與篩選條件內已記錄、上游有回報的用量。未知欄位不代表零；快取讀取已包含在輸入中，不重複計入總
                Token。快取比例只比較同時回報輸入與快取的樣本。這些數字不代表供應商帳單或剩餘額度；歷史用途仍計入合計。
              </p>
              <p>
                快取比例樣本：{exact.format(summary!.cache_read.cached_prompt_tokens)}／
                {exact.format(summary!.cache_read.prompt_tokens)} Token（
                {exact.format(summary!.cache_read.reported_calls)}{' '}
                次呼叫）。其他已回報的快取仍計入快取讀取總量。
              </p>
            </details>
            <p className={styles.time}>
              {data!.range.start
                ? `${display.date(data!.range.start)} — ${display.date(data!.range.end)}`
                : `全部留存 · 截至 ${display.date(data!.range.end)}`}{' '}
              · {data!.range.timezone}
            </p>
          </footer>
        </>
      )}
    </section>
  )
}
