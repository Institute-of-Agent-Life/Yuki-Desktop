// Delegations and observations (Client API 14): Works a native agent executes on one of the
// person's devices, with no Yuki loop. They are read, cancelled and answered as Works.
import { useEffect, useSyncExternalStore } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import type { DelegationPage, DelegationRequest, Work } from '../../shared/api'
import type { ConnectorDevice, ConnectorOperation, ConnectorTarget } from '../../shared/connector'
import { Banner, Button, Sheet, StatusPill, type Status } from '../components/Controls'
import { ClientProblem, unwrap } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { formatDateTime } from '../../shared/time'
import { useTranslation } from '../i18n'
import { NativeRequest } from './NativeRequest'
import styles from './Works.module.css'

type T = TFunction<['works', 'common']>
type Delegation = NonNullable<Work['delegation']>
type Runs = Work & { delegation: Delegation }
const live: Record<string, [Status, 'running' | 'waiting' | 'unknown']> = {
  running: ['running', 'running'],
  waiting: ['waiting', 'waiting'],
  unknown: ['unknown', 'unknown'],
}
const ended: Record<string, [Status, 'completed' | 'failed' | 'cancelled']> = {
  completed: ['done', 'completed'],
  failed: ['failed', 'failed'],
  cancelled: ['offline', 'cancelled'],
}
/** The record's settled state (Yuki's settlement of native facts, not a native string). */
export function delegationState(t: T, delegation: Delegation): [Status, string] {
  const running = live[delegation.state]
  if (running) return [running[0], t(`works:delegation.state.${running[1]}`)]
  const done = ended[delegation.state]
  // A state newer than this app shows the server's own word.
  return done ? [done[0], t(`works:state.${done[1]}`)] : ['unknown', delegation.state]
}
export const relationshipLabel = (t: T, delegation: Delegation) =>
  t(
    delegation.relationship === 'observe'
      ? 'works:delegation.relationship.observe'
      : delegation.relationship === 'takeover'
        ? 'works:delegation.relationship.takeover'
        : 'works:delegation.relationship.delegate',
  )
export const agentName = (delegation: Delegation) =>
  delegation.executor.label ?? delegation.executor.agent ?? ''
const reasons = ['device_offline', 'executor_lost'] as const
/** The record's state in this app's words; the server's own status line is its language. */
export function delegationStatus(t: T, work: Runs) {
  const delegation = work.delegation,
    agent = agentName(delegation),
    state = delegation.state
  if (delegation.relationship === 'observe' && live[state])
    return t('works:delegation.status.observe', { agent })
  if (state === 'unknown') {
    const reason = reasons.find((item) => item === work.reason)
    return reason
      ? t('works:delegation.status.unknownReason', {
          agent,
          reason: t(`works:delegation.reason.${reason}`),
        })
      : t('works:delegation.status.unknown', { agent })
  }
  const named = (['running', 'waiting', 'completed', 'failed', 'cancelled'] as const).find(
    (item) => item === state,
  )
  if (named) return t(`works:delegation.status.${named}`, { agent })
  return t('works:delegation.status.other', { agent, state })
}
/** Cancelling a delegation cancels its native turn; cancelling an observation only stops it. */
export const observes = (work: Work) => work.delegation?.relationship === 'observe'
export const isDelegation = (work: Work): work is Runs => !!work.delegation

/** Delegation records and the device directory have their own cache keys: the palette
 * reads every `[id, 'works', …]` entry as a page of root Works. */
export function refreshDelegations(query: QueryClient, id: string) {
  for (const key of ['delegations', 'agent-devices'])
    void query.invalidateQueries({ queryKey: [id, key] }, { cancelRefetch: false })
}
/** Every delegation and observation of this person, on all their devices. */
export function useDelegations(id: string) {
  return useQuery({
    queryKey: [id, 'delegations', 'active'],
    queryFn: () =>
      window.yuki.client
        .read<DelegationPage>(id, { kind: 'delegations', group: 'active' })
        .then(unwrap)
        .then((page) => page.delegations.filter(isDelegation)),
  })
}
export function useAgentDevices(id: string) {
  return useQuery({
    queryKey: [id, 'agent-devices'],
    queryFn: () => window.yuki.connector.devices(id).then(unwrap),
  })
}

export function DelegationRow({
  work,
  selected,
  open,
  cancel,
}: {
  work: Runs
  selected?: string
  open(workId: string): void
  cancel(work: Work): void
}) {
  const { t } = useTranslation(['works', 'common'])
  const { zone, locale } = useDisplayTime()
  const [status, label] = delegationState(t, work.delegation)
  const line = t('works:delegation.line', {
    relationship: relationshipLabel(t, work.delegation),
    status: delegationStatus(t, work),
  })
  return (
    <div className={styles.delegation} data-delegation={work.work_id}>
      <button
        className={styles.row}
        aria-current={selected === work.work_id ? 'true' : undefined}
        onClick={() => open(work.work_id)}
      >
        <span className={styles.state}>
          <StatusPill status={status}>{label}</StatusPill>
        </span>
        <span className={styles.goal} title={work.goal}>
          {work.goal}
        </span>
        <small title={line}>{line}</small>
        <time>{formatDateTime(work.updated_at, zone, locale)}</time>
      </button>
      <Button variant="plain" onClick={() => cancel(work)}>
        {t(observes(work) ? 'works:delegation.stop' : 'works:delegation.cancel')}
      </Button>
    </div>
  )
}

/** What each of the person's devices runs now: facts only, never a limit. */
export function DeviceRuns({
  works,
  devices,
  selected,
  open,
  cancel,
}: {
  works: Runs[]
  devices: ConnectorDevice[]
  selected?: string
  open(workId: string): void
  cancel(work: Work): void
}) {
  const { t } = useTranslation(['works', 'common'])
  const place = (work: Runs) => work.delegation.executor.device_id ?? ''
  const ids = [...new Set([...devices.map((device) => device.id), ...works.map(place)])]
  return (
    <section aria-label={t('works:delegation.devices')} data-frost-children>
      <h3>{t('works:delegation.devices')}</h3>
      {ids.map((deviceId) => {
        const device = devices.find((item) => item.id === deviceId)
        const runs = works.filter((work) => place(work) === deviceId)
        const count = (state: string) =>
          runs.filter((work) => work.delegation.state === state).length
        const label = device?.label ?? (deviceId || t('works:delegation.unknownDevice'))
        return (
          <div key={deviceId} role="group" aria-label={label} className={styles.device}>
            <header>
              <h4>{label}</h4>
              <small>
                {device
                  ? t(device.online ? 'works:delegation.online' : 'works:delegation.offline')
                  : t('works:delegation.unlisted')}
              </small>
              <small>
                {t('works:delegation.counts', {
                  running: count('running'),
                  waiting: count('waiting'),
                  unknown: count('unknown'),
                })}
              </small>
            </header>
            {runs.length ? (
              runs.map((work) => (
                <DelegationRow
                  key={work.work_id}
                  work={work}
                  selected={selected}
                  open={open}
                  cancel={cancel}
                />
              ))
            ) : (
              <p className={styles.secondary}>{t('works:delegation.idle')}</p>
            )}
          </div>
        )
      })}
    </section>
  )
}

type Choice = { optionId: string } | { response: NonNullable<ConnectorTarget['response']> }
type Result =
  | 'answered'
  | 'answeredElsewhere'
  | 'observeOnly'
  | 'noLongerPending'
  | 'unconfirmed'
  | { message: string }
/** One answer to one native request (per Yuki, Work and request), shared by every place
 * that shows the request: one guard, one request ID, one outcome. */
interface Attempt {
  id: string
  workId: string
  permission: string
  agent: string
  choice: Choice
  requestId: string
  sending: boolean
  result?: Result
}
const attempts = new Map<string, Attempt>()
const listeners = new Set<() => void>()
let version = 0
const attemptKey = (id: string, workId: string, permission: string) =>
  JSON.stringify([id, workId, permission])
function put(attempt: Attempt) {
  attempts.set(attemptKey(attempt.id, attempt.workId, attempt.permission), attempt)
  version++
  listeners.forEach((listener) => listener())
}
function useAttempts() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
  return attempts
}
async function answer(
  query: QueryClient,
  target: Pick<Attempt, 'id' | 'workId' | 'permission' | 'agent'>,
  choice: Choice,
) {
  const previous = attempts.get(attemptKey(target.id, target.workId, target.permission))
  if (previous?.sending) return
  // An answer whose commit is unknown is asked again under its original request ID, so the
  // server reports its own receipt instead of taking a second answer.
  const requestId =
    previous?.result === 'unconfirmed' && JSON.stringify(previous.choice) === JSON.stringify(choice)
      ? previous.requestId
      : crypto.randomUUID()
  const attempt: Attempt = { ...target, choice, requestId, sending: true, result: previous?.result }
  put(attempt)
  let result: Result
  try {
    unwrap(
      await window.yuki.client.nativeAnswer(target.id, target.workId, target.permission, {
        requestId,
        ...choice,
      }),
    )
    result = 'answered'
  } catch (error) {
    const code = error instanceof ClientProblem ? error.code : 'unknown'
    result =
      code === 'transport_unknown' || code === 'unknown'
        ? 'unconfirmed'
        : code === 'request_already_answered'
          ? 'answeredElsewhere'
          : code === 'observe_only'
            ? 'observeOnly'
            : code === 'not_found'
              ? 'noLongerPending'
              : { message: error instanceof Error ? error.message : code }
  }
  put({ ...attempt, sending: false, result })
  refreshDelegations(query, target.id)
  void query.invalidateQueries({ queryKey: [target.id, 'work', target.workId] })
}
function Outcome({ attempt }: { attempt: Attempt }) {
  const { t } = useTranslation(['works', 'common'])
  const result = attempt.result
  if (!result) return null
  return (
    <Banner
      status={result === 'answered' ? 'done' : result === 'unconfirmed' ? 'unknown' : 'failed'}
    >
      {typeof result === 'object'
        ? result.message
        : result === 'answered'
          ? t('works:delegation.answered', { agent: attempt.agent })
          : result === 'unconfirmed'
            ? t('works:delegation.answerUnconfirmed')
            : t(`works:delegation.${result}`)}
    </Banner>
  )
}
/** Answers of requests no longer pending here; an unconfirmed one reads its real outcome. */
export function AnsweredRequests({
  id,
  workId,
  pending,
}: {
  id: string
  /** Only this record's answers; all of this Yuki's when absent. */
  workId?: string
  pending: Set<string>
}) {
  const query = useQueryClient()
  const shown = [...useAttempts().values()].filter(
    (attempt) =>
      attempt.id === id &&
      (!workId || attempt.workId === workId) &&
      !pending.has(attemptKey(id, attempt.workId, attempt.permission)),
  )
  useEffect(() => {
    for (const attempt of shown)
      if (attempt.result === 'unconfirmed' && !attempt.sending)
        void answer(query, attempt, attempt.choice)
  })
  return shown.map((attempt) => (
    <Outcome key={attemptKey(id, attempt.workId, attempt.permission)} attempt={attempt} />
  ))
}
/** Whether this view has answered a native request of this Yuki. */
export const useAnswered = (id: string) =>
  [...useAttempts().values()].some((attempt) => attempt.id === id)
export const pendingKeys = (id: string, works: Runs[]) =>
  new Set(
    works.flatMap((work) =>
      work.delegation.pending.map((item) => attemptKey(id, work.work_id, item.permission_id)),
    ),
  )

/** One pending native request of a delegation: the request's own options, answered once. */
export function PendingRequest({
  id,
  work,
  item,
}: {
  id: string
  work: Runs
  item: DelegationRequest
}) {
  const { t } = useTranslation(['works', 'common'])
  const query = useQueryClient()
  const attempt = useAttempts().get(attemptKey(id, work.work_id, item.permission_id))
  const agent = agentName(work.delegation)
  // The original native event carries the full request (questions, decisions); its
  // permission ID is the event's cursor, so the page after the previous cursor starts with it.
  const original = useQuery({
    queryKey: [id, 'native-request', item.operation_id, item.permission_id],
    queryFn: async () => {
      const operation = unwrap(
        await window.yuki.connector.operation(
          id,
          item.operation_id!,
          Number(item.permission_id) - 1,
        ),
      )
      return operation.events?.find((event) => event.permission_id === item.permission_id) ?? null
    },
    enabled: !!item.operation_id,
  })
  const event: NonNullable<ConnectorOperation['events']>[number] = original.data ?? {
    cursor: Number(item.permission_id),
    kind: item.kind,
    permission_id: item.permission_id,
    payload: { tool: item.tool ?? null, options: item.options ?? null },
  }
  const tool = typeof item.tool === 'string' ? item.tool : ''
  return (
    <div className={styles.request} data-native-request={item.permission_id}>
      <p>
        {item.kind === 'question'
          ? t('works:delegation.question', { agent })
          : tool
            ? t('works:delegation.permissionTool', { agent, tool })
            : t('works:delegation.permission', { agent })}
      </p>
      <div className={styles.requestBody}>
        <NativeRequest
          event={event}
          busy={!!attempt?.sending}
          observed={item.answer_at === 'native_terminal'}
          // Only the owner's requests are answerable; any other answer place fails closed.
          onRespond={
            item.answer_at === 'yuki_or_user'
              ? (extra) =>
                  answer(
                    query,
                    { id, workId: work.work_id, permission: item.permission_id, agent },
                    extra.response
                      ? { response: extra.response }
                      : { optionId: String(extra.option_id) },
                  )
              : undefined
          }
        />
      </div>
      {item.answer_at === 'deny_only' && (
        // A wait no operation received: only its metadata left that computer.
        <>
          <p>{t('works:delegation.denyOnly')}</p>
          <div>
            <Button
              disabled={!!attempt?.sending}
              onClick={() =>
                void answer(
                  query,
                  { id, workId: work.work_id, permission: item.permission_id, agent },
                  { optionId: 'deny' },
                )
              }
            >
              {t('works:delegation.deny')}
            </Button>
          </div>
        </>
      )}
      {attempt && <Outcome attempt={attempt} />}
    </div>
  )
}

/** The record itself in its Work detail: who runs it where, and what waits for an answer. */
export function DelegationFacts({
  id,
  work,
  open,
}: {
  id: string
  work: Runs
  open(workId: string): void
}) {
  const { t } = useTranslation(['works', 'common'])
  const { zone, locale } = useDisplayTime()
  const devices = useAgentDevices(id)
  const delegation = work.delegation
  const deviceId = delegation.executor.device_id
  const device = devices.data?.find((item) => item.id === deviceId)
  return (
    <section className={styles.delegationFacts} aria-label={relationshipLabel(t, delegation)}>
      <h3>{relationshipLabel(t, delegation)}</h3>
      <p>{delegationStatus(t, work)}</p>
      <p className={styles.secondary}>
        {t('works:delegation.executor', {
          agent: agentName(delegation),
          device: device?.label ?? (deviceId || t('works:delegation.unknownDevice')),
        })}
        {device &&
          ` · ${t(device.online ? 'works:delegation.online' : 'works:delegation.offline')}`}
      </p>
      {delegation.executor.session && (
        <p className={styles.secondary}>
          {t('works:delegation.session', { id: delegation.executor.session })}
        </p>
      )}
      {delegation.last_event_at && (
        <p className={styles.secondary}>
          {t('works:delegation.lastEvent', {
            time: formatDateTime(delegation.last_event_at, zone, locale),
          })}
        </p>
      )}
      {work.parent_work_id && (
        <Button variant="plain" onClick={() => open(work.parent_work_id!)}>
          {t('works:delegation.parent')}
        </Button>
      )}
      {delegation.pending.map((item) => (
        <PendingRequest key={item.permission_id} id={id} work={work} item={item} />
      ))}
      <AnsweredRequests id={id} workId={work.work_id} pending={pendingKeys(id, [work])} />
    </section>
  )
}

/** The original receipt of a native operation a step refers to; answers belong to the
 * delegation that waits for them, so this record has no answer controls. */
export function OperationReceipt({
  id,
  operationId,
  close,
}: {
  id: string
  operationId?: string
  close(): void
}) {
  const { t } = useTranslation(['works', 'connector', 'common'])
  const detail = useInfiniteQuery({
    queryKey: ['connector-operation', id, operationId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      window.yuki.connector.operation(id, operationId!, pageParam).then(unwrap),
    getNextPageParam: (page, _pages, cursor) =>
      page.next_cursor !== cursor ? page.next_cursor : undefined,
    enabled: !!operationId,
  })
  const pages = detail.data?.pages
  const latest = pages?.at(-1)
  return (
    <Sheet
      title={t('works:operation', { id: operationId ?? '' })}
      open={!!operationId}
      width={640}
      onClose={close}
      actions={
        <Button variant="primary" onClick={close}>
          {t('common:action.close')}
        </Button>
      }
    >
      {detail.isPending && <p role="status">{t('connector:tasks.readingReceipt')}</p>}
      {detail.isError && <Banner status="unknown">{detail.error.message}</Banner>}
      {latest && (
        <>
          <p className={styles.secondary}>
            {t('connector:statusLine', { status: latest.status })}
            {' · '}
            {t('connector:tasks.sessionOf', {
              id: latest.session_id ?? t('connector:tasks.unknownId'),
            })}
          </p>
          {pages!
            .flatMap((page) => page.events ?? [])
            .map((event) => (
              <NativeRequest key={event.cursor} event={event} />
            ))}
          {detail.hasNextPage && (
            <Button
              variant="plain"
              loading={detail.isFetchingNextPage}
              onClick={() => void detail.fetchNextPage()}
            >
              {t('connector:tasks.moreProgress')}
            </Button>
          )}
        </>
      )}
    </Sheet>
  )
}
