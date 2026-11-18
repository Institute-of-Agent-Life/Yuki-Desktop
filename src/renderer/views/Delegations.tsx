// Delegations and observations (Client API 14): Works a native agent executes on one of the
// person's devices, with no Yuki loop. They are read, cancelled and answered as Works.
import { useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
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
/** Cancelling a delegation cancels its native turn; cancelling an observation only stops it. */
export const observes = (work: Work) => work.delegation?.relationship === 'observe'
export const isDelegation = (work: Work): work is Runs => !!work.delegation

/** Every delegation and observation of this person, on all their devices. */
export function useDelegations(id: string) {
  return useQuery({
    queryKey: [id, 'works', 'delegations', 'active'],
    queryFn: () =>
      window.yuki.client
        .read<DelegationPage>(id, { kind: 'delegations', group: 'active' })
        .then(unwrap)
        .then((page) => page.delegations.filter(isDelegation)),
  })
}
export function useAgentDevices(id: string) {
  return useQuery({
    queryKey: [id, 'works', 'agent-devices'],
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
    status: work.delegation.status_line,
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
    <section aria-label={t('works:delegation.devices')}>
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

export interface AnswerOutcome {
  status: Status
  text: string
}
/** Outcomes of this view's answers, kept after a refresh removes the answered request. */
export function useAnswerOutcomes() {
  const [outcomes, setOutcomes] = useState<Record<string, AnswerOutcome>>({})
  return {
    outcomes,
    record: (permission: string, outcome: AnswerOutcome) =>
      setOutcomes((current) => ({ ...current, [permission]: outcome })),
  }
}
export function AnsweredRequests({
  outcomes,
  pending,
}: {
  outcomes: Record<string, AnswerOutcome>
  pending: Set<string>
}) {
  return Object.entries(outcomes)
    .filter(([permission]) => !pending.has(permission))
    .map(([permission, outcome]) => (
      <Banner key={permission} status={outcome.status}>
        {outcome.text}
      </Banner>
    ))
}

/** One pending native request of a delegation: the request's own options, answered once. */
export function PendingRequest({
  id,
  work,
  item,
  outcome,
  record,
}: {
  id: string
  work: Runs
  item: DelegationRequest
  outcome?: AnswerOutcome
  record(permission: string, outcome: AnswerOutcome): void
}) {
  const { t } = useTranslation(['works', 'common'])
  const query = useQueryClient()
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  // A lost reply is retried under the same request ID, so the server reports its own receipt.
  const attempt = useRef<{ key: string; requestId: string }>(undefined)
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
  const answer = async (extra: Partial<ConnectorTarget>) => {
    if (sending.current) return
    sending.current = true
    const choice = extra.response
      ? { response: extra.response }
      : { optionId: String(extra.option_id) }
    const key = JSON.stringify(choice)
    const requestId = attempt.current?.key === key ? attempt.current.requestId : crypto.randomUUID()
    attempt.current = { key, requestId }
    setBusy(true)
    try {
      const receipt = unwrap(
        await window.yuki.client.nativeAnswer(id, work.work_id, item.permission_id, {
          requestId,
          ...choice,
        }),
      )
      attempt.current = undefined
      record(item.permission_id, {
        status: 'done',
        text: t('works:delegation.answered', { agent, status: receipt.status }),
      })
    } catch (error) {
      const code = error instanceof ClientProblem ? error.code : 'unknown'
      if (code !== 'transport_unknown') attempt.current = undefined
      record(item.permission_id, {
        status: code === 'transport_unknown' ? 'unknown' : 'failed',
        text:
          code === 'request_already_answered'
            ? t('works:delegation.answeredElsewhere')
            : code === 'observe_only'
              ? t('works:delegation.observeOnly')
              : code === 'not_found'
                ? t('works:delegation.noLongerPending')
                : code === 'transport_unknown'
                  ? t('works:delegation.answerUnconfirmed')
                  : error instanceof Error
                    ? error.message
                    : code,
      })
    } finally {
      sending.current = false
      setBusy(false)
      void query.invalidateQueries({ queryKey: [id, 'works'] })
      void query.invalidateQueries({ queryKey: [id, 'work', work.work_id] })
    }
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
          busy={busy}
          observed={item.answer_at === 'native_terminal'}
          onRespond={answer}
        />
      </div>
      {outcome && <Banner status={outcome.status}>{outcome.text}</Banner>}
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
  const { outcomes, record } = useAnswerOutcomes()
  const delegation = work.delegation
  const deviceId = delegation.executor.device_id
  const device = devices.data?.find((item) => item.id === deviceId)
  return (
    <section className={styles.delegationFacts} aria-label={relationshipLabel(t, delegation)}>
      <h3>{relationshipLabel(t, delegation)}</h3>
      <p>{delegation.status_line}</p>
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
        <PendingRequest
          key={item.permission_id}
          id={id}
          work={work}
          item={item}
          outcome={outcomes[item.permission_id]}
          record={record}
        />
      ))}
      <AnsweredRequests
        outcomes={outcomes}
        pending={new Set(delegation.pending.map((item) => item.permission_id))}
      />
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
