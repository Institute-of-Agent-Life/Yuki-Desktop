import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import type {
  ModelStatsQuery,
  ModelStatsView,
  ModelUsageGroup,
  ModelUsageStats,
} from '../../shared/models'
import { Banner, Segmented, Spinner } from '../components/Controls'
import { unwrap } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'
import { modelTaskLabel } from './model-document'
import styles from './ModelUsage.module.css'

type Field = keyof ModelUsageStats['coverage']
type GroupBy = ModelStatsView['group_by']

// Numbers follow the interface language; a language switch re-renders through the hook.
function useNumbers() {
  const { t, i18n } = useTranslation(['models'])
  const exact = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 })
  const compact = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 })
  const percentage = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  const quantity = (value: number) => {
    for (const [size, suffix] of [
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ] as const) {
      if (value >= size) return `${compact.format(value / size)} ${suffix}`
    }
    return exact.format(value)
  }
  const tokens = (stats: ModelUsageStats, field: Field, full = false) => {
    if (stats.invocations && !stats.coverage[field]) return t('models:usage.unknown')
    return full ? exact.format(stats[field]) : quantity(stats[field])
  }
  return { exact, percentage, quantity, tokens }
}

function StatsDetail({ stats }: { stats: ModelUsageStats }) {
  const { t } = useTranslation(['models'])
  const { exact, tokens } = useNumbers()
  const fields: [string, string][] = [
    [t('models:usage.promptTokens'), tokens(stats, 'prompt_tokens', true)],
    [t('models:usage.completionTokens'), tokens(stats, 'completion_tokens', true)],
    [t('models:usage.cacheRead'), tokens(stats, 'cached_prompt_tokens', true)],
    [t('models:usage.cacheCreation'), tokens(stats, 'cache_creation_input_tokens', true)],
    [t('models:usage.invocations'), exact.format(stats.invocations)],
    [t('models:usage.failures'), exact.format(stats.failures)],
    [t('models:usage.unknownUsage'), exact.format(stats.unknown_usage)],
    [
      t('models:usage.averageLatency'),
      t('models:usage.seconds', { seconds: exact.format(stats.average_latency_seconds) }),
    ],
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
  const { t } = useTranslation(['models'])
  const { exact, percentage, tokens } = useNumbers()
  const calls = (count: number) =>
    t('models:usage.invocationCount', { count, value: exact.format(count) })
  const name =
    by === 'model'
      ? group.model || t('models:usage.unlabeledModel')
      : historical
        ? group.task || t('models:usage.unlabeledTask')
        : modelTaskLabel(t, group.task!)
  const models = [...new Set(group.sources.map((source) => source.model))]
  const description =
    by === 'model'
      ? group.provider || t('models:usage.unlabeledProvider')
      : models.length === 1
        ? models[0] || t('models:usage.unlabeledModel')
        : t('models:usage.models', {
            count: models.length,
            value: exact.format(models.length),
          })
  const known = group.stats.coverage.total_tokens > 0
  const share = total && known ? group.stats.total_tokens / total : null
  return (
    <details className={styles.group} data-disclosure="row">
      <summary className={styles.groupSummary}>
        <div className={styles.groupName}>
          <strong title={name}>{name}</strong>
          <span>
            {description} · {calls(group.stats.invocations)}
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
          <summary>{t('models:usage.sources')}</summary>
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
                  {source.model || t('models:usage.unlabeledModel')} ·{' '}
                  {source.provider || t('models:usage.unlabeledProvider')}
                </span>
                <span>
                  {t('models:usage.originalTask')}{' '}
                  <code>{source.task || t('models:usage.unlabeled')}</code> ·{' '}
                  {t('models:usage.originalProfile')}{' '}
                  <code>{source.profile_id || t('models:usage.unlabeled')}</code>
                </span>
                <span>
                  {t('models:usage.tokenAmount', {
                    tokens: tokens(source.stats, 'total_tokens', true),
                  })}{' '}
                  · {calls(source.stats.invocations)}
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
  const { t } = useTranslation(['models'])
  const display = useDisplayTime()
  const { exact, percentage, quantity, tokens } = useNumbers()
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
    <section aria-label={t('models:usage.title')} className={styles.usage}>
      <header className={styles.header}>
        <div>
          <h2>{t('models:usage.heading')}</h2>
          <p>{t('models:usage.intro')}</p>
        </div>
        <Segmented
          kind="radio"
          label={t('models:usage.ranges')}
          items={[
            { value: 'today', label: t('models:usage.range.today') },
            { value: '24h', label: t('models:usage.range.last24h') },
            { value: '7d', label: t('models:usage.range.last7d') },
            { value: 'all', label: t('models:usage.range.all') },
          ]}
          value={period.range}
          onChange={changeRange}
        />
      </header>
      {stats.error ? (
        <Banner status="failed">{stats.error.message}</Banner>
      ) : stats.isPending ? (
        <Spinner />
      ) : (
        <>
          <div className={styles.hero} aria-label={t('models:usage.summary')}>
            <p className={styles.eyebrow}>
              {t('models:usage.reported')}{' '}
              {filter && (
                <span>
                  · <span>{t('models:usage.filtered')}</span>
                </span>
              )}
            </p>
            <div className={styles.total}>
              <output
                aria-label={t('models:usage.reported')}
                title={tokens(summary!, 'total_tokens', true)}
              >
                {tokens(summary!, 'total_tokens')}
              </output>
              <span>{t('models:usage.tokenUnit')}</span>
            </div>
            <dl className={styles.metrics}>
              <div>
                <dt>{t('models:usage.input')}</dt>
                <dd title={tokens(summary!, 'prompt_tokens', true)}>
                  {tokens(summary!, 'prompt_tokens')}
                </dd>
              </div>
              <div>
                <dt>{t('models:usage.output')}</dt>
                <dd title={tokens(summary!, 'completion_tokens', true)}>
                  {tokens(summary!, 'completion_tokens')}
                </dd>
              </div>
              <div>
                <dt>{t('models:usage.calls')}</dt>
                <dd>
                  {t('models:usage.callCount', {
                    count: summary!.invocations,
                    value: exact.format(summary!.invocations),
                  })}
                </dd>
              </div>
            </dl>
            <div className={styles.cache}>
              <span>{t('models:usage.cacheRead')}</span>
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
                  ? t('models:usage.ratioNotApplicable')
                  : t('models:usage.pairedInput', {
                      percent: percentage.format(summary!.cache_read.ratio),
                    })}
              </span>
            </div>
            {summary!.cache_read.reported_calls < summary!.invocations && (
              <p className={styles.coverage}>
                {t('models:usage.coverage', {
                  count: summary!.invocations,
                  reported: exact.format(summary!.cache_read.reported_calls),
                  value: exact.format(summary!.invocations),
                })}
              </p>
            )}
          </div>
          <div className={styles.groupBar}>
            <Segmented
              kind="radio"
              label={t('models:usage.groups')}
              items={[
                { value: 'model', label: t('models:usage.byModel') },
                { value: 'task', label: t('models:usage.byTask') },
              ]}
              value={by}
              onChange={changeGroup}
            />
            <label className={styles.filter}>
              <span>{t(by === 'model' ? 'models:usage.byTask' : 'models:usage.byModel')}</span>
              <select
                aria-label={t(
                  by === 'model' ? 'models:usage.filterTask' : 'models:usage.filterModel',
                )}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="">
                  {t(by === 'model' ? 'models:usage.allTasks' : 'models:usage.allModels')}
                </option>
                {by === 'model'
                  ? data!.options.tasks.filter(currentTask).map((task) => (
                      <option key={task} value={task}>
                        {modelTaskLabel(t, task)}
                      </option>
                    ))
                  : data!.options.models.map((item) => (
                      <option
                        key={JSON.stringify([item.provider, item.model])}
                        value={JSON.stringify([item.provider, item.model])}
                      >
                        {item.model || t('models:usage.unlabeledModel')} ·{' '}
                        {item.provider || t('models:usage.unlabeledProvider')}
                      </option>
                    ))}
              </select>
            </label>
          </div>
          {summary!.invocations === 0 ? (
            <p className={styles.empty}>{t('models:usage.empty')}</p>
          ) : (
            <div className={styles.groups}>
              <div className={styles.listCaption}>
                <span>{t('models:usage.sortedByTokens')}</span>
                <span>{t('models:usage.columns')}</span>
              </div>
              {visible.map((group) => (
                <UsageGroup key={key(group)} group={group} by={by} total={summary!.total_tokens} />
              ))}
              {historical.length > 0 && (
                <details className={styles.history} data-disclosure="row">
                  <summary>
                    <span>{t('models:usage.history')}</span>
                    <span>
                      {t('models:usage.tokenAmount', {
                        tokens: historical.some((group) => group.stats.coverage.total_tokens > 0)
                          ? quantity(
                              historical.reduce(
                                (value, group) => value + group.stats.total_tokens,
                                0,
                              ),
                            )
                          : t('models:usage.unknown'),
                      })}
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
              <p>
                {t('models:usage.incomplete', {
                  count: summary!.unknown_usage,
                  value: exact.format(summary!.unknown_usage),
                })}
              </p>
            )}
            <details>
              <summary>{t('models:usage.notes')}</summary>
              <p>{t('models:usage.explanation')}</p>
              <p>
                {t('models:usage.sample', {
                  count: summary!.cache_read.reported_calls,
                  cached: exact.format(summary!.cache_read.cached_prompt_tokens),
                  prompt: exact.format(summary!.cache_read.prompt_tokens),
                  value: exact.format(summary!.cache_read.reported_calls),
                })}
              </p>
            </details>
            <p className={styles.time}>
              {data!.range.start
                ? `${display.date(data!.range.start)} — ${display.date(data!.range.end)}`
                : t('models:usage.allRetainedUntil', { date: display.date(data!.range.end) })}{' '}
              · {data!.range.timezone}
            </p>
          </footer>
        </>
      )}
    </section>
  )
}
