import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleHelp, File, X } from 'lucide-react'
import type {
  ArtifactSource,
  Work,
  WorkCommandItem,
  WorkDraftQuestion,
  WorkQuestionDraft,
  WorkPage,
  WorkSteps,
} from '../../shared/api'
import { normalizeMessageText } from '../../shared/message'
import { Composer } from '../components/Composer'
import { WorkCard, StepRow, middleTruncate } from '../components/Content'
import {
  Banner,
  Button,
  EmptyState,
  IconButton,
  Segmented,
  Sheet,
  StatusPill,
  type Status,
} from '../components/Controls'
import { hidesPrivateData, problemText, unwrap } from '../queries/client'
import { useWorkspace } from '../state/workspace'
import styles from './Works.module.css'
import chatStyles from './Conversation.module.css'
import { Markdown } from '../text/RichMarkdown'
import { formatDateTime } from '../../shared/time'
import type { Language } from '../../shared/locales'
import type { DisplayTimeZone } from '../../shared/desktop'
import { useDisplayTime } from '../state/time'
import type { TFunction } from 'i18next'
import { useTranslation } from '../i18n'

type T = TFunction<['works', 'common']>
const terminal = (work: Work) => ['completed', 'failed', 'cancelled'].includes(work.state)
const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)
type StateKey =
  'running' | 'waiting' | 'waitingUser' | 'paused' | 'completed' | 'failed' | 'cancelled'
const states: Record<Work['state'], [Status, StateKey]> = {
  queued: ['running', 'running'],
  running: ['running', 'running'],
  waiting_external: ['waiting', 'waiting'],
  waiting_user: ['waiting', 'waitingUser'],
  suspended: ['waiting', 'paused'],
  completed: ['done', 'completed'],
  failed: ['failed', 'failed'],
  cancelled: ['offline', 'cancelled'],
}
const stateLabel = (t: T, state: Work['state']) => t(`works:state.${states[state]![1]}`)
const workState = (t: T, work: Work): [Status, string] => [
  states[work.state]![0],
  stateLabel(t, work.state),
]
// Backend step categories this app has words for; any other shows the backend's own label.
const stepCategories = [
  'terminal',
  'search',
  'web',
  'file',
  'agent',
  'device',
  'memory',
  'message',
  'computer',
  'browser',
  'other',
] as const
const stepLabel = (t: T, step: WorkSteps['steps'][number]) => {
  const label = (stepCategories as readonly string[]).includes(step.category)
    ? t(`works:step.${step.category as (typeof stepCategories)[number]}`)
    : step.label
  return step.status === 'recorded' ? t('works:step.recorded', { label }) : label
}
const time = formatDateTime
const source = (t: T, work: Work) =>
  work.source.platform === 'app'
    ? t('works:source.app')
    : [
        t(work.source.kind === 'group' ? 'works:source.group' : 'works:source.private', {
          platform: work.source.platform?.toUpperCase() ?? t('works:originalEntry'),
        }),
        work.source.display_name,
      ]
        .filter(Boolean)
        .join(' · ')
function waitText(t: T, wait: Work['wait'], zone: DisplayTimeZone, locale: Language): string {
  if (!wait) return ''
  const parts = wait.conditions.map((condition) => {
    if (condition.kind === 'time_due')
      return t('works:wait.until', { time: time(condition.due_at, zone, locale) })
    if (condition.kind === 'conversation') return t('works:wait.message')
    if (condition.kind === 'plugin_event') return t('works:wait.pluginEvent')
    return condition.run_kind === 'terminal'
      ? t('works:wait.terminal')
      : condition.run_kind === 'acp'
        ? t('works:wait.agent')
        : ['wait_control', 'help_request'].includes(condition.run_kind)
          ? t('works:wait.computer')
          : t('works:wait.result')
  })
  const items = parts.slice(0, 2).join(t('works:wait.separator'))
  return [
    parts.length === 1
      ? parts[0]!
      : parts.length > 2
        ? t(wait.mode === 'any' ? 'works:wait.anyMore' : 'works:wait.allMore', {
            items,
            count: parts.length,
          })
        : t(wait.mode === 'any' ? 'works:wait.any' : 'works:wait.all', { items }),
    wait.deadline_at && t('works:wait.deadline', { time: time(wait.deadline_at, zone, locale) }),
  ]
    .filter(Boolean)
    .join(' · ')
}

export function WorkList({
  id,
  selected,
  open,
}: {
  id: string
  selected?: string
  open(workId: string): void
}) {
  const workspace = useWorkspace()
  const { t } = useTranslation(['works', 'common'])
  const { zone, locale, group: dateGroup } = useDisplayTime()
  const [origin, setOrigin] = useState<'all' | 'this_entry' | 'other'>('all')
  const query = useQueryClient()
  const active = useInfiniteQuery({
    queryKey: [id, 'works', 'active', origin],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      read<WorkPage>(id, {
        kind: 'works',
        group: 'active',
        origin,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.next_before ?? undefined,
  })
  const ended = useInfiniteQuery({
    queryKey: [id, 'works', 'ended', origin],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      read<WorkPage>(id, {
        kind: 'works',
        group: 'ended',
        origin,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.next_before ?? undefined,
  })
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['sync', 'work', 'commands', 'computer'].includes(kind))
          void query.invalidateQueries({ queryKey: [id, 'works'] })
      }),
    [id, query],
  )
  const failed = active.error ?? ended.error
  const activeWorks = hidesPrivateData(failed)
    ? []
    : unique(active.data?.pages.flatMap((page) => page.works) ?? [])
  const endedWorks = hidesPrivateData(failed)
    ? []
    : unique(ended.data?.pages.flatMap((page) => page.works) ?? [])
  const needs = (work: Work) => work.state === 'waiting_user' || work.help_requested
  const rows = (works: Work[]) =>
    works.map((work) => (
      <button
        key={work.work_id}
        className={styles.row}
        title={t('works:doubleClick')}
        aria-current={selected === work.work_id ? 'true' : undefined}
        onClick={() => open(work.work_id)}
        onDoubleClick={() => {
          open(work.work_id)
          workspace.patch({ focusMode: true })
        }}
      >
        <span className={styles.state}>
          <StatusPill status={workState(t, work)[0]}>{workState(t, work)[1]}</StatusPill>
        </span>
        <span className={styles.goal} title={work.goal}>
          {work.goal}
        </span>
        <small title={source(t, work)}>{source(t, work)}</small>
        <time>{time(work.updated_at, zone, locale)}</time>
      </button>
    ))
  const scroll = (element: HTMLDivElement) => {
    if (element.scrollHeight - element.scrollTop - element.clientHeight > 160) return
    if (active.hasNextPage && !active.isFetchingNextPage) void active.fetchNextPage()
    else if (ended.hasNextPage && !ended.isFetchingNextPage) void ended.fetchNextPage()
  }
  return (
    <div className={styles.list} onScroll={(event) => scroll(event.currentTarget)}>
      <header>
        <Segmented
          label={t('works:origin')}
          value={origin}
          onChange={setOrigin}
          items={[
            { value: 'all', label: t('works:originAll') },
            { value: 'this_entry', label: t('works:originDesktop') },
            { value: 'other', label: t('works:originOther') },
          ]}
        />
      </header>
      {failed && (
        <Banner status="failed">
          {failed.message}
          <Button
            variant="plain"
            onClick={() => {
              void active.refetch()
              void ended.refetch()
            }}
          >
            {t('common:action.retry')}
          </Button>
        </Banner>
      )}
      {!!activeWorks.filter(needs).length && (
        <section>
          <h3>{t('works:needsYou')}</h3>
          {rows(activeWorks.filter(needs))}
        </section>
      )}
      {!!activeWorks.filter((work) => !needs(work)).length && (
        <section>
          <h3>{t('works:inProgress')}</h3>
          {rows(activeWorks.filter((work) => !needs(work)))}
        </section>
      )}
      {!!endedWorks.length && (
        <section>
          <h3>{t('works:ended')}</h3>
          {endedWorks.map((work, index) => (
            <div key={work.work_id}>
              {(!index ||
                dateGroup(work.updated_at) !== dateGroup(endedWorks[index - 1]!.updated_at)) && (
                <h4>{dateGroup(work.updated_at)}</h4>
              )}
              {rows([work])}
            </div>
          ))}
        </section>
      )}
      {active.hasNextPage && (
        <Button
          variant="plain"
          loading={active.isFetchingNextPage}
          onClick={() => void active.fetchNextPage()}
        >
          {t('works:moreActive')}
        </Button>
      )}
      {ended.hasNextPage && (
        <Button
          variant="plain"
          loading={ended.isFetchingNextPage}
          onClick={() => void ended.fetchNextPage()}
        >
          {t('works:earlier')}
        </Button>
      )}
      {!active.isPending &&
        !ended.isPending &&
        !failed &&
        !activeWorks.length &&
        !endedWorks.length && (
          <EmptyState title={t('works:empty')}>{t('works:emptyDescription')}</EmptyState>
        )}
    </div>
  )
}

export function WorkDetail({
  id,
  platform,
  workId,
  open,
  replyInChat,
  commandEnter = false,
  artifact,
  computer,
}: {
  id: string
  platform: string
  workId: string
  open(workId: string): void
  replyInChat(work: Work): void
  commandEnter?: boolean
  artifact(source: ArtifactSource): void
  computer?: () => void
}) {
  const { zone, locale } = useDisplayTime()
  const { t } = useTranslation(['works', 'common'])
  const query = useQueryClient(),
    [cancel, setCancel] = useState<Work | null>(null),
    [linkProblem, setLinkProblem] = useState('')
  const work = useQuery({
    queryKey: [id, 'work', workId],
    queryFn: () => read<Work>(id, { kind: 'work', workId }),
  })
  const steps = useInfiniteQuery({
    queryKey: [id, 'steps', workId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      read<WorkSteps>(id, { kind: 'steps', workId, ...(pageParam ? { after: pageParam } : {}) }),
    getNextPageParam: (page) => page.next_after ?? undefined,
  })
  useEffect(() => {
    void query.invalidateQueries({ queryKey: [id, 'steps', workId] }, { cancelRefetch: false })
  }, [id, workId, query, work.data?.steps_token])
  const commands = useQuery({
    queryKey: [id, 'commands'],
    queryFn: () => window.yuki.client.workCommands(id).then(unwrap),
  })
  const questionDrafts = useQuery({
    queryKey: [id, 'work-question-drafts', workId],
    queryFn: () => window.yuki.client.workQuestionDrafts(id, workId).then(unwrap),
  })
  const allSteps = [
    ...new Map(
      steps.data?.pages.flatMap((page) => page.steps).map((step) => [step.step_id, step]),
    ).values(),
  ]
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind, data) => {
        if (character !== id) return
        const original = data as { work_id?: string }
        const needsSync =
          !work.data ||
          !terminal(work.data) ||
          allSteps.some((step) => ['recorded', 'running'].includes(step.status))
        if (
          (kind === 'sync' && needsSync) ||
          (['work', 'work_steps'].includes(kind) && original.work_id === workId) ||
          kind === 'commands' ||
          kind === 'computer' ||
          kind === 'refresh'
        ) {
          void query.invalidateQueries({ queryKey: [id, 'work', workId] }, { cancelRefetch: false })
          void query.invalidateQueries(
            { queryKey: [id, 'steps', workId] },
            { cancelRefetch: false },
          )
        }
        if (kind === 'commands') {
          void query.invalidateQueries({ queryKey: [id, 'commands'] })
          void query.invalidateQueries({ queryKey: [id, 'work-question-drafts', workId] })
        }
      }),
    [id, workId, query, work.data, allSteps],
  )
  const failure = work.error ?? steps.error
  const data = hidesPrivateData(failure) ? undefined : work.data
  const latest = steps.data?.pages.at(-1)
  const refresh = () => {
    void query.invalidateQueries({ queryKey: [id, 'work', workId] })
    void query.invalidateQueries({ queryKey: [id, 'steps', workId] })
    void query.invalidateQueries({ queryKey: [id, 'work-question-drafts', workId] })
  }
  return (
    <div className={styles.detail} data-work-detail>
      {failure && (
        <Banner status="failed">
          {failure.message}
          <Button variant="plain" onClick={refresh}>
            {t('common:action.retry')}
          </Button>
        </Banner>
      )}
      {data && (
        <>
          <div className={styles.status}>
            <StatusPill status={workState(t, data)[0]}>{workState(t, data)[1]}</StatusPill>
            {!terminal(data) && (
              <Button variant="destructive" onClick={() => setCancel(data)}>
                {t('works:cancelWork')}
              </Button>
            )}
          </div>
          <h2>{data.goal}</h2>
          <p className={styles.secondary}>
            {source(t, data)} ·{' '}
            {t('works:resultTo', {
              target:
                data.result_delivery.platform === 'app'
                  ? t('works:source.app')
                  : `${data.result_delivery.platform?.toUpperCase() ?? t('works:originalEntry')} ${data.result_delivery.display_name}`,
            })}
          </p>
          {data.state === 'suspended' && (
            <Banner>
              {t('works:suspended', { reason: data.reason || t('works:state.paused') })}
            </Banner>
          )}
          {data.wait && <p className={styles.secondary}>{waitText(t, data.wait, zone, locale)}</p>}
          {data.waiting_question && !terminal(data) && (
            <QuestionBox
              key={`${data.waiting_question.conversation_id}/${data.waiting_question.event_id}`}
              id={id}
              platform={platform}
              work={data}
              question={data.waiting_question}
              done={refresh}
              replyInChat={replyInChat}
              commandEnter={commandEnter}
            />
          )}
          <section>
            <h3>{t('works:steps')}</h3>
            {computer &&
              (data.help_requested ||
                allSteps.some((step) => ['browser', 'computer'].includes(step.category))) && (
                <Button variant="plain" onClick={computer}>
                  {t('works:viewOnComputer')}
                </Button>
              )}
            {allSteps.map((step) => (
              <StepRow
                key={step.step_id}
                label={stepLabel(t, step)}
                status={
                  step.status === 'succeeded'
                    ? 'done'
                    : step.status === 'failed'
                      ? 'failed'
                      : step.status === 'unknown'
                        ? 'unknown'
                        : step.status === 'recorded'
                          ? 'unknown'
                          : 'running'
                }
                time={time(step.updated_at, zone, locale)}
              />
            ))}
            {steps.hasNextPage && (
              <Button
                variant="plain"
                loading={steps.isFetchingNextPage}
                onClick={() => void steps.fetchNextPage()}
              >
                {t('works:moreSteps')}
              </Button>
            )}
            {allSteps.some((step) => step.status === 'unknown') && (
              <p className={styles.secondary}>{t('works:verifying')}</p>
            )}
          </section>
          {!!latest?.children.length && (
            <section>
              <h3>{t('works:children')}</h3>
              {latest.children.map((child) => (
                <Button key={child.work_id} variant="plain" onClick={() => open(child.work_id)}>
                  {child.goal} · {stateLabel(t, child.state)}
                </Button>
              ))}
            </section>
          )}
          {!!data.results.length && (
            <section>
              <h3>{t('works:results')}</h3>
              {data.results.map((result) => (
                <Markdown
                  key={result.event_id}
                  id={id}
                  text={result.text}
                  className={chatStyles.markdown}
                  onProblem={setLinkProblem}
                />
              ))}
              {linkProblem && <Banner status="failed">{linkProblem}</Banner>}
              <WorkArtifacts work={data} open={artifact} />
            </section>
          )}
          {questionDrafts.error && (
            <Banner status="failed">
              {t('works:draftsUnreadable')}
              <Button variant="plain" onClick={() => void questionDrafts.refetch()}>
                {t('works:reloadDrafts')}
              </Button>
            </Banner>
          )}
          <RetainedAnswers
            drafts={(questionDrafts.data ?? []).filter(
              (draft) =>
                terminal(data) ||
                draft.question.eventId !== data.waiting_question?.event_id ||
                draft.question.conversationId !== data.waiting_question?.conversation_id,
            )}
          />
          <WorkReply
            id={id}
            platform={platform}
            work={data}
            done={refresh}
            commandEnter={commandEnter}
            inline
            readOnly={terminal(data)}
          />
          <details className={styles.secondary}>
            <summary>{t('works:usage')}</summary>
            {t('works:usageModels', {
              used: data.budget.models,
              limit: data.budget.model_limit ?? t('works:unlimited'),
            })}{' '}
            ·{' '}
            {data.budget.tool_limit === null
              ? t('works:usageTools', { used: data.budget.tools })
              : t('works:usageToolsLimited', {
                  used: data.budget.tools,
                  limit: data.budget.tool_limit,
                })}
          </details>
          {(commands.data ?? [])
            .filter(
              (item) => item.command.workId === workId && (item.state !== 'result' || item.problem),
            )
            .map((item) => (
              <CommandStatus key={item.requestId} id={id} item={item} />
            ))}
        </>
      )}
      <CancelWorkSheet id={id} work={cancel} close={() => setCancel(null)} />
    </div>
  )
}

function RetainedAnswers({ drafts }: { drafts: WorkQuestionDraft[] }) {
  const { t } = useTranslation(['works', 'common'])
  const [problem, setProblem] = useState('')
  if (!drafts.length) return null
  return (
    <section aria-label={t('works:unsentAnswers')} className={styles.retained}>
      <h3>{t('works:unsentAnswers')}</h3>
      <p className={styles.secondary}>{t('works:unsentNote')}</p>
      {drafts.map(({ question, text }, index) => (
        <div
          key={`${question.conversationId}/${question.eventId}`}
          data-question-event={question.eventId}
        >
          <textarea
            className={styles.inlineField}
            readOnly
            aria-label={t('works:unsentAnswer', { index: index + 1 })}
            value={text}
          />
          <Button
            variant="plain"
            onClick={() =>
              void window.yuki.client
                .copy(text)
                .then(unwrap)
                .catch((error) => setProblem(error.message))
            }
          >
            {t('works:copyAnswer')}
          </Button>
        </div>
      ))}
      {problem && <Banner status="failed">{problem}</Banner>}
    </section>
  )
}

function QuestionBox({
  id,
  platform,
  work,
  question,
  done,
  replyInChat,
  commandEnter,
}: {
  id: string
  platform: string
  work: Work
  question: NonNullable<Work['waiting_question']>
  done(): void
  replyInChat(work: Work): void
  commandEnter: boolean
}) {
  const { t } = useTranslation(['works', 'common'])
  const [answer, setAnswer] = useState(false),
    [problem, setProblem] = useState(''),
    root = useRef<HTMLDivElement>(null)
  return (
    <div className={styles.question} ref={root}>
      <div className={styles.questionLabel}>
        <CircleHelp size={16} />
        <Markdown
          id={id}
          text={question.text}
          className={chatStyles.markdown}
          onProblem={setProblem}
        />
      </div>
      {problem && <Banner status="failed">{problem}</Banner>}
      {answer ? (
        <WorkReply
          id={id}
          platform={platform}
          work={work}
          done={done}
          commandEnter={commandEnter}
          inline
          autoFocus
          question={{ conversationId: question.conversation_id, eventId: question.event_id }}
          close={() => {
            setAnswer(false)
            requestAnimationFrame(() =>
              root.current?.querySelector<HTMLButtonElement>('button[data-answer]')?.focus(),
            )
          }}
        />
      ) : (
        <>
          <Button data-answer onClick={() => setAnswer(true)}>
            {t('works:reply')}
          </Button>
          <Button variant="plain" onClick={() => replyInChat(work)}>
            {t('works:answerInChat')}
          </Button>
        </>
      )}
    </div>
  )
}

export function WorkReply({
  id,
  platform,
  work,
  done,
  close,
  commandEnter = false,
  inline = false,
  autoFocus = false,
  question,
  readOnly = false,
}: {
  id: string
  platform: string
  work: Work
  done(): void
  close?: () => void
  commandEnter?: boolean
  inline?: boolean
  autoFocus?: boolean
  question?: WorkDraftQuestion
  readOnly?: boolean
}) {
  const { t } = useTranslation(['works', 'common'])
  const query = useQueryClient()
  const [draft, setDraft] = useState(''),
    [problem, setProblem] = useState(''),
    [sending, setSending] = useState(false),
    current = useRef('')
  const input = useRef<HTMLTextAreaElement>(null)
  const edited = useRef(0)
  useEffect(() => {
    let active = true
    const version = edited.current
    void window.yuki.client
      .workDraft(id, work.work_id, undefined, question)
      .then(unwrap)
      .then((text) => {
        if (active && edited.current === version) {
          current.current = text
          setDraft(text)
        }
      })
      .catch((error) => {
        if (active) setProblem(error.message)
      })
    return () => {
      active = false
    }
  }, [id, work.work_id, question?.conversationId, question?.eventId])
  useEffect(() => {
    if (inline && input.current) {
      input.current.style.height = 'auto'
      input.current.style.height = `${Math.max(28, input.current.scrollHeight + 2)}px`
    }
  }, [inline, draft])
  const update = (text: string) => {
    edited.current++
    current.current = text
    setDraft(text)
    void window.yuki.client
      .workDraft(id, work.work_id, text, question)
      .then(unwrap)
      .then(() => query.invalidateQueries({ queryKey: [id, 'work-question-drafts', work.work_id] }))
      .catch((error) => setProblem(error.message))
  }
  const submit = async () => {
    const submitted = current.current
    const result = unwrap(
      await window.yuki.client.workCommand(
        id,
        { kind: 'input', workId: work.work_id, text: submitted },
        question,
      ),
    )
    if (result.problem) setProblem(problemText(result.problem))
    if (current.current === submitted) {
      current.current = ''
      setDraft('')
    }
    done()
  }
  const sendInline = async () => {
    if (readOnly || sending || !normalizeMessageText(current.current)) return
    setSending(true)
    setProblem('')
    try {
      await submit()
    } catch {
      setProblem(t('works:notSent'))
    } finally {
      setSending(false)
    }
  }
  if (readOnly && !draft) return null
  return (
    <div data-work-reply className={`${styles.reply} ${inline ? styles.inlineReply : ''}`}>
      {!inline && (
        <header>
          <span>{t('works:addTo', { goal: work.goal })}</span>
          {close && (
            <IconButton label={t('works:cancelReply')} onClick={close}>
              <X size={14} />
            </IconButton>
          )}
        </header>
      )}
      {inline ? (
        <>
          {!question && <div className={styles.inputLabel}>{t('works:addition')}</div>}
          <div className={styles.inputRow}>
            <textarea
              ref={input}
              className={styles.inlineField}
              rows={1}
              autoFocus={autoFocus}
              aria-label={
                question ? t('works:answerQuestion') : t('works:addTo', { goal: work.goal })
              }
              placeholder={question ? t('works:answerQuestion') : t('works:sendToWork')}
              value={draft}
              readOnly={readOnly}
              onChange={(event) => update(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && close) {
                  event.stopPropagation()
                  close()
                } else if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229 &&
                  (!commandEnter || event.metaKey || event.ctrlKey)
                ) {
                  event.preventDefault()
                  void sendInline()
                }
              }}
            />
            {readOnly ? (
              <Button
                aria-label={t('works:copyUnsent')}
                onClick={() =>
                  void window.yuki.client
                    .copy(draft)
                    .then(unwrap)
                    .catch((error) => setProblem(error.message))
                }
              >
                {t('works:copyAddition')}
              </Button>
            ) : (
              <Button
                variant={question ? 'primary' : 'secondary'}
                aria-label={question ? t('works:sendAnswer') : t('works:sendToWork')}
                loading={sending}
                disabled={readOnly || !normalizeMessageText(draft)}
                onClick={() => void sendInline()}
              >
                {question ? t('works:submit') : t('works:send')}
              </Button>
            )}
            {close && (
              <IconButton label={t('works:collapse')} onClick={close}>
                <X size={14} />
              </IconButton>
            )}
          </div>
          {readOnly && <p className={styles.secondary}>{t('works:endedNote')}</p>}
        </>
      ) : (
        <Composer
          name={work.goal}
          platform={platform}
          commandEnter={commandEnter}
          draft={draft}
          onDraft={update}
          onSubmit={submit}
        />
      )}
      {problem && <Banner status="failed">{problem}</Banner>}
    </div>
  )
}
function CommandStatus({ id, item }: { id: string; item: WorkCommandItem }) {
  const { t } = useTranslation(['works', 'common'])
  const [problem, setProblem] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <div className={styles.command}>
      <span>
        {item.problem
          ? problemText(item.problem)
          : item.state === 'draft'
            ? t('works:sendWhenConnected')
            : t('works:unconfirmed')}
      </span>
      {item.command.kind === 'input' && <p>{item.command.text}</p>}
      {item.state !== 'result' && (
        <Button
          variant="plain"
          loading={busy}
          onClick={() => {
            setBusy(true)
            void window.yuki.client
              .verifyWorkCommand(id, item.requestId)
              .then(unwrap)
              .catch((error) => setProblem(error.message))
              .finally(() => setBusy(false))
          }}
        >
          {t('works:check')}
        </Button>
      )}
      {problem && <span>{problem}</span>}
    </div>
  )
}
export function ConversationWork({
  id,
  work,
  open,
  reply,
}: {
  id: string
  work: Work | string
  open(workId: string): void
  reply(work: Work): void
}) {
  const { zone, locale } = useDisplayTime()
  const { t } = useTranslation(['works', 'common'])
  const [cancel, setCancel] = useState<Work | null>(null)
  const workId = typeof work === 'string' ? work : work.work_id
  const detail = useQuery({
    queryKey: [id, 'work', workId],
    queryFn: () => read<Work>(id, { kind: 'work', workId }),
    initialData: typeof work === 'string' ? undefined : work,
  })
  // A Work the Host opened only to carry a private request's tools is that request itself;
  // the conversation already shows it, so its card stays in the Works list alone.
  if (hidesPrivateData(detail.error) || !detail.data || detail.data.admission === 'host_execution')
    return null
  const data = detail.data,
    [status, label] = workState(t, data)
  return (
    <>
      <WorkCard
        title={data.goal}
        status={status}
        statusLabel={label}
        detail={data.wait ? waitText(t, data.wait, zone, locale) : undefined}
        question={data.waiting_question?.text}
        onOpen={() => open(data.work_id)}
        onReply={() => reply(data)}
        onCancel={!terminal(data) ? () => setCancel(data) : undefined}
      />
      <CancelWorkSheet id={id} work={cancel} close={() => setCancel(null)} />
    </>
  )
}
function CancelWorkSheet({ id, work, close }: { id: string; work: Work | null; close(): void }) {
  const { t } = useTranslation(['works', 'common'])
  const query = useQueryClient(),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState('')
  useEffect(() => {
    if (work) setProblem('')
  }, [work])
  const submit = async () => {
    if (!work) return
    setBusy(true)
    try {
      const result = unwrap(
        await window.yuki.client.workCommand(id, {
          kind: 'cancel',
          workId: work.work_id,
          expectedRevision: work.revision,
        }),
      )
      setProblem(
        result.problem === 'version_conflict'
          ? t('works:cancelConflict')
          : result.problem
            ? problemText(result.problem)
            : result.state !== 'result'
              ? t('works:cancelUnconfirmed')
              : '',
      )
      close()
      void query.invalidateQueries({ queryKey: [id, 'work', work.work_id] })
      void query.invalidateQueries({ queryKey: [id, 'works'] })
      void query.invalidateQueries({ queryKey: [id, 'home'] })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t('works:cancelFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {problem && <Banner status="failed">{problem}</Banner>}
      <Sheet
        title={t('works:cancelTitle')}
        open={!!work}
        onClose={close}
        actions={
          <>
            <Button onClick={close}>{t('works:keepRunning')}</Button>
            <Button variant="destructive" loading={busy} onClick={() => void submit()}>
              {t('works:cancelAnyway')}
            </Button>
          </>
        }
      >
        <p>{work?.goal}</p>
        <p>{t('works:cancelNote')}</p>
      </Sheet>
    </>
  )
}
function WorkArtifacts({ work, open }: { work: Work; open(source: ArtifactSource): void }) {
  const items = [
    ...new Map(
      work.results
        .flatMap((result) => result.artifacts)
        .flatMap((item) =>
          typeof item.artifact_id === 'string' && typeof item.version === 'string'
            ? [
                [
                  `${item.artifact_id}/${item.version}`,
                  {
                    artifactId: item.artifact_id,
                    version: item.version,
                    name: typeof item.filename === 'string' ? item.filename : item.artifact_id,
                  },
                ] as const,
              ]
            : [],
        ),
    ).values(),
  ]
  if (!items.length) return null
  return (
    <div className={styles.artifactList}>
      {items.map((item) => (
        <button
          className={styles.artifact}
          key={`${item.artifactId}/${item.version}`}
          title={`${item.name} · ${item.artifactId} · ${item.version}`}
          onClick={() => open(item)}
        >
          <File size={18} />
          <span>
            {middleTruncate(item.name)}
            <small>
              {item.version.slice(0, 4)}…{item.version.slice(-4)}
            </small>
          </span>
        </button>
      ))}
    </div>
  )
}
function unique(works: Work[]) {
  return [...new Map(works.map((work) => [work.work_id, work])).values()]
}
