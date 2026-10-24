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
import { formatDateTime } from '../../shared/time'
import type { DisplayTimeZone } from '../../shared/desktop'
import { useDisplayTime } from '../state/time'

const terminal = (work: Work) => ['completed', 'failed', 'cancelled'].includes(work.state)
const read = <T,>(id: string, route: Parameters<typeof window.yuki.client.read>[1]) =>
  window.yuki.client.read<T>(id, route).then(unwrap)
const states: Record<Work['state'], [Status, string]> = {
  queued: ['running', '執行中'],
  running: ['running', '執行中'],
  waiting_external: ['waiting', '等待中'],
  waiting_user: ['waiting', '等你回覆'],
  suspended: ['waiting', '已暫停'],
  completed: ['done', '已完成'],
  failed: ['failed', '失敗'],
  cancelled: ['offline', '已取消'],
}
export const workState = (work: Work): [Status, string] => states[work.state]!
const time = formatDateTime
const source = (work: Work) =>
  work.source.platform === 'app'
    ? '桌面對話'
    : `${work.source.platform?.toUpperCase() ?? '原入口'} ${work.source.kind === 'group' ? '群' : '私聊'}${work.source.display_name ? ` · ${work.source.display_name}` : ''}`
export function waitText(wait: Work['wait'], zone: DisplayTimeZone = 'Asia/Taipei'): string {
  if (!wait) return ''
  const parts = wait.conditions.map((condition) => {
    if (condition.kind === 'time_due') return `等到 ${time(condition.due_at, zone)}`
    if (condition.kind === 'conversation') return '等待新的訊息'
    if (condition.kind === 'plugin_event') return '等待外掛事件'
    return condition.run_kind === 'terminal'
      ? '等待終端工作完成'
      : condition.run_kind === 'acp'
        ? '等待其他 Agent 回覆'
        : ['wait_control', 'help_request'].includes(condition.run_kind)
          ? '等待電腦交回'
          : '等待執行結果'
  })
  return (
    (parts.length === 1
      ? parts[0]!
      : `等待${wait.mode === 'any' ? '其中一項' : '全部完成'}：${parts.slice(0, 2).join('、')}${parts.length > 2 ? ` 等 ${parts.length} 項` : ''}`) +
    (wait.deadline_at ? ` · 最晚 ${time(wait.deadline_at, zone)}` : '')
  )
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
  const { zone, group: dateGroup } = useDisplayTime()
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
        aria-current={selected === work.work_id ? 'true' : undefined}
        onClick={() => open(work.work_id)}
        onDoubleClick={() => {
          open(work.work_id)
          workspace.patch({ focusMode: true })
        }}
      >
        <span className={styles.state}>
          <StatusPill status={workState(work)[0]}>{workState(work)[1]}</StatusPill>
        </span>
        <span className={styles.goal} title={work.goal}>
          {work.goal}
        </span>
        <small title={source(work)}>{source(work)}</small>
        <time>{time(work.updated_at, zone)}</time>
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
        <h2>工作</h2>
        <Segmented
          label="工作來源"
          value={origin}
          onChange={setOrigin}
          items={[
            { value: 'all', label: '全部' },
            { value: 'this_entry', label: '我在桌面交辦的' },
            { value: 'other', label: '來自其他入口' },
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
            重試
          </Button>
        </Banner>
      )}
      {!!activeWorks.filter(needs).length && (
        <section>
          <h3>需要你</h3>
          {rows(activeWorks.filter(needs))}
        </section>
      )}
      {!!activeWorks.filter((work) => !needs(work)).length && (
        <section>
          <h3>進行中</h3>
          {rows(activeWorks.filter((work) => !needs(work)))}
        </section>
      )}
      {!!endedWorks.length && (
        <section>
          <h3>已結束</h3>
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
          載入更多進行中工作
        </Button>
      )}
      {ended.hasNextPage && (
        <Button
          variant="plain"
          loading={ended.isFetchingNextPage}
          onClick={() => void ended.fetchNextPage()}
        >
          載入更早工作
        </Button>
      )}
      {!active.isPending &&
        !ended.isPending &&
        !failed &&
        !activeWorks.length &&
        !endedWorks.length && (
          <EmptyState title="目前沒有工作">在對話中交給 Yuki 的事會出現在這裡。</EmptyState>
        )}
    </div>
  )
}

export function WorkDetail({
  id,
  workId,
  open,
  replyInChat,
  commandEnter = false,
  artifact,
  computer,
}: {
  id: string
  workId: string
  open(workId: string): void
  replyInChat(work: Work): void
  commandEnter?: boolean
  artifact(source: ArtifactSource): void
  computer?: () => void
}) {
  const { zone } = useDisplayTime()
  const query = useQueryClient(),
    [cancel, setCancel] = useState<Work | null>(null)
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
    <div className={styles.detail}>
      {failure && (
        <Banner status="failed">
          {failure.message}
          <Button variant="plain" onClick={refresh}>
            重試
          </Button>
        </Banner>
      )}
      {data && (
        <>
          <StatusPill status={workState(data)[0]}>{workState(data)[1]}</StatusPill>
          <h2>{data.goal}</h2>
          <p className={styles.secondary}>
            {source(data)} · 結果會傳到：
            {data.result_delivery.platform === 'app'
              ? '桌面對話'
              : `${data.result_delivery.platform?.toUpperCase() ?? '原入口'} ${data.result_delivery.display_name}`}
          </p>
          {data.state === 'suspended' && (
            <Banner>
              {data.reason || '已暫停'}。補充要求會送進原工作；是否繼續由 Yuki 依目前狀況決定。
            </Banner>
          )}
          {data.wait && <p className={styles.secondary}>{waitText(data.wait, zone)}</p>}
          {data.waiting_question && !terminal(data) && (
            <QuestionBox
              key={`${data.waiting_question.conversation_id}/${data.waiting_question.event_id}`}
              id={id}
              work={data}
              question={data.waiting_question}
              done={refresh}
              replyInChat={replyInChat}
              commandEnter={commandEnter}
            />
          )}
          <section>
            <h3>步驟</h3>
            {computer &&
              (data.help_requested ||
                allSteps.some((step) => ['browser', 'computer'].includes(step.category))) && (
                <Button variant="plain" onClick={computer}>
                  在電腦上查看
                </Button>
              )}
            {allSteps.map((step) => (
              <StepRow
                key={step.step_id}
                label={`${step.label}${step.status === 'recorded' ? ' · 已開始，結果尚未記錄' : ''}`}
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
                time={time(step.updated_at, zone)}
              />
            ))}
            {steps.hasNextPage && (
              <Button
                variant="plain"
                loading={steps.isFetchingNextPage}
                onClick={() => void steps.fetchNextPage()}
              >
                載入更多步驟
              </Button>
            )}
            {allSteps.some((step) => step.status === 'unknown') && (
              <p className={styles.secondary}>Yuki 正在確認原操作是否已生效。</p>
            )}
          </section>
          {!!latest?.children.length && (
            <section>
              <h3>子工作</h3>
              {latest.children.map((child) => (
                <Button key={child.work_id} variant="plain" onClick={() => open(child.work_id)}>
                  {child.goal} · {states[child.state]![1]}
                </Button>
              ))}
            </section>
          )}
          {!!data.results.length && (
            <section>
              <h3>已傳送的訊息與成果</h3>
              {data.results.map((result) => (
                <p key={result.event_id}>{result.text}</p>
              ))}
              <WorkArtifacts work={data} open={artifact} />
            </section>
          )}
          {questionDrafts.error && (
            <Banner status="failed">
              未送出的回答暫時無法讀取。
              <Button variant="plain" onClick={() => void questionDrafts.refetch()}>
                重新讀取草稿
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
            work={data}
            done={refresh}
            commandEnter={commandEnter}
            inline
            readOnly={terminal(data)}
          />
          <p className={styles.secondary}>
            模型請求 {data.budget.models}／{data.budget.model_limit ?? '無上限'} · 工具呼叫{' '}
            {data.budget.tools}
            {data.budget.tool_limit === null ? '' : `／${data.budget.tool_limit}`}
          </p>
          {!terminal(data) && (
            <Button variant="destructive" onClick={() => setCancel(data)}>
              取消工作
            </Button>
          )}
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
  const [problem, setProblem] = useState('')
  if (!drafts.length) return null
  return (
    <section aria-label="未送出的回答" className={styles.retained}>
      <h3>未送出的回答</h3>
      <p className={styles.secondary}>
        原問題已結束或更新。這些回答保留在這台電腦，不會送給下一個問題。
      </p>
      {drafts.map(({ question, text }, index) => (
        <div
          key={`${question.conversationId}/${question.eventId}`}
          data-question-event={question.eventId}
        >
          <textarea
            className={styles.inlineField}
            readOnly
            aria-label={`未送出的回答 ${index + 1}`}
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
            複製回答
          </Button>
        </div>
      ))}
      {problem && <Banner status="failed">{problem}</Banner>}
    </section>
  )
}

function QuestionBox({
  id,
  work,
  question,
  done,
  replyInChat,
  commandEnter,
}: {
  id: string
  work: Work
  question: NonNullable<Work['waiting_question']>
  done(): void
  replyInChat(work: Work): void
  commandEnter: boolean
}) {
  const [answer, setAnswer] = useState(false),
    root = useRef<HTMLDivElement>(null)
  return (
    <div className={styles.question} ref={root}>
      <p className={styles.questionLabel}>
        <CircleHelp size={16} />
        <span>{question.text}</span>
      </p>
      {answer ? (
        <WorkReply
          id={id}
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
            回覆
          </Button>
          <Button variant="plain" onClick={() => replyInChat(work)}>
            在對話中回答
          </Button>
        </>
      )}
    </div>
  )
}

export function WorkReply({
  id,
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
  work: Work
  done(): void
  close?: () => void
  commandEnter?: boolean
  inline?: boolean
  autoFocus?: boolean
  question?: WorkDraftQuestion
  readOnly?: boolean
}) {
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
      setProblem('尚未送出，已保留內容。')
    } finally {
      setSending(false)
    }
  }
  if (readOnly && !draft) return null
  return (
    <div data-work-reply className={`${styles.reply} ${inline ? styles.inlineReply : ''}`}>
      {!inline && (
        <header>
          <span>補充給：{work.goal}</span>
          {close && (
            <IconButton label="取消回覆工作" onClick={close}>
              <X size={14} />
            </IconButton>
          )}
        </header>
      )}
      {inline ? (
        <>
          {!question && <div className={styles.inputLabel}>補充要求</div>}
          <div className={styles.inputRow}>
            <textarea
              ref={input}
              className={styles.inlineField}
              rows={1}
              autoFocus={autoFocus}
              aria-label={question ? '回答這個問題' : `補充給：${work.goal}`}
              placeholder={question ? '回答這個問題' : '傳送給這項工作'}
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
                aria-label="複製未送出的補充"
                onClick={() =>
                  void window.yuki.client
                    .copy(draft)
                    .then(unwrap)
                    .catch((error) => setProblem(error.message))
                }
              >
                複製補充
              </Button>
            ) : (
              <Button
                variant={question ? 'primary' : 'secondary'}
                aria-label={question ? '送出回答' : '傳送給這項工作'}
                loading={sending}
                disabled={readOnly || !normalizeMessageText(draft)}
                onClick={() => void sendInline()}
              >
                {question ? '送出' : '傳送'}
              </Button>
            )}
            {close && (
              <IconButton label="收起回答" onClick={close}>
                <X size={14} />
              </IconButton>
            )}
          </div>
          {readOnly && (
            <p className={styles.secondary}>工作已結束，未送出的補充保留在這裡，可選取複製。</p>
          )}
        </>
      ) : (
        <Composer
          name={work.goal}
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
  const [problem, setProblem] = useState(''),
    [busy, setBusy] = useState(false)
  return (
    <div className={styles.command}>
      <span>
        {item.problem
          ? problemText(item.problem)
          : item.state === 'draft'
            ? '連線後送出原請求'
            : '原請求狀態未確認'}
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
          查詢
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
  artifact,
}: {
  id: string
  work: Work | string
  open(workId: string): void
  reply(work: Work): void
  artifact(source: ArtifactSource): void
}) {
  const { zone } = useDisplayTime()
  const [cancel, setCancel] = useState<Work | null>(null)
  const workId = typeof work === 'string' ? work : work.work_id
  const detail = useQuery({
    queryKey: [id, 'work', workId],
    queryFn: () => read<Work>(id, { kind: 'work', workId }),
    initialData: typeof work === 'string' ? undefined : work,
  })
  if (hidesPrivateData(detail.error) || !detail.data) return null
  const data = detail.data,
    [status, label] = workState(data)
  return (
    <>
      <WorkCard
        title={data.goal}
        status={status}
        statusLabel={label}
        detail={`${data.step_count ?? 0} 個步驟 · ${data.child_count} 個子工作${data.wait ? ` · ${waitText(data.wait, zone)}` : ''}`}
        question={data.waiting_question?.text}
        onOpen={() => open(data.work_id)}
        onReply={() => reply(data)}
        onCancel={!terminal(data) ? () => setCancel(data) : undefined}
      >
        <WorkArtifacts work={data} open={artifact} limit={3} all={() => open(data.work_id)} />
      </WorkCard>
      <CancelWorkSheet id={id} work={cancel} close={() => setCancel(null)} />
    </>
  )
}
function CancelWorkSheet({ id, work, close }: { id: string; work: Work | null; close(): void }) {
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
          ? '工作狀態已改變，請確認最新狀態後再取消。'
          : result.problem
            ? problemText(result.problem)
            : result.state !== 'result'
              ? '取消狀態未確認，正在查證原請求。'
              : '',
      )
      close()
      void query.invalidateQueries({ queryKey: [id, 'work', work.work_id] })
      void query.invalidateQueries({ queryKey: [id, 'works'] })
      void query.invalidateQueries({ queryKey: [id, 'home'] })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '取消未完成。')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {problem && <Banner status="failed">{problem}</Banner>}
      <Sheet
        title="取消這項工作？"
        open={!!work}
        onClose={close}
        actions={
          <>
            <Button onClick={close}>保持執行</Button>
            <Button variant="destructive" loading={busy} onClick={() => void submit()}>
              仍然取消
            </Button>
          </>
        }
      >
        <p>{work?.goal}</p>
        <p>這會停止原工作；已完成的步驟不會被撤銷。</p>
      </Sheet>
    </>
  )
}
function WorkArtifacts({
  work,
  open,
  limit,
  all,
}: {
  work: Work
  open(source: ArtifactSource): void
  limit?: number
  all?: () => void
}) {
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
      {items.slice(0, limit).map((item) => (
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
      {limit !== undefined && items.length > limit && all && (
        <Button variant="plain" onClick={all}>
          其他 {items.length - limit} 個
        </Button>
      )}
    </div>
  )
}
function unique(works: Work[]) {
  return [...new Map(works.map((work) => [work.work_id, work])).values()]
}
