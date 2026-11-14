import { useState } from 'react'
import type { TFunction } from 'i18next'
import type { ConnectorOperation, ConnectorTarget } from '../../shared/connector'
import { Button, TextField } from '../components/Controls'
import { Row } from './SettingsRow'
import styles from './Settings.module.css'
import { useTranslation } from '../i18n'

type Event = NonNullable<ConnectorOperation['events']>[number]
type JsonValue = NonNullable<ConnectorTarget['response']>[string]
function record(value: unknown): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
}
type Access = 'read' | 'write' | 'deny'
function permissionPath(t: TFunction<['connector']>, value: JsonValue) {
  const path = record(value)
  if (path.type === 'path') return String(path.path)
  if (path.type === 'glob_pattern')
    return t('connector:native.globPattern', { pattern: String(path.pattern) })
  const special = record(path.value)
  const kind = String(special.kind)
  const name =
    kind === 'unknown'
      ? special.path
      : kind === 'slash_tmp'
        ? '/tmp'
        : t(`connector:native.scope.${kind as 'root' | 'minimal' | 'project_roots' | 'tmpdir'}`)
  return [name, special.subpath].filter(Boolean).join('/')
}
function PermissionScope({ value }: { value: unknown }) {
  const { t } = useTranslation(['connector'])
  const permissions = record(value)
  const files = record(permissions.fileSystem)
  const network = record(permissions.network)
  return (
    <div className={styles.link}>
      {Array.isArray(files.entries) &&
        files.entries.map((value, index) => {
          const entry = record(value)
          return (
            <p key={index}>
              {t(`connector:native.access.${String(entry.access) as Access}`, {
                path: permissionPath(t, entry.path!),
              })}
            </p>
          )
        })}
      {(['read', 'write'] as const).map((kind) =>
        Array.isArray(files[kind])
          ? files[kind].map((path, index) => (
              <p key={`${kind}/${index}`}>
                {t(`connector:native.access.${kind}`, { path: String(path) })}
              </p>
            ))
          : null,
      )}
      {typeof files.globScanMaxDepth === 'number' && (
        <p>{t('connector:native.globDepth', { depth: files.globScanMaxDepth })}</p>
      )}
      {typeof network.enabled === 'boolean' && (
        <p>
          {network.enabled
            ? t('connector:native.networkAllowed')
            : t('connector:native.networkUnchanged')}
        </p>
      )}
    </div>
  )
}
export function NativeRequest({
  event,
  busy,
  onRespond,
}: {
  event: Event
  busy: boolean
  onRespond(extra: Partial<ConnectorTarget>): Promise<void>
}) {
  const { t } = useTranslation(['connector'])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const payload = record(event.payload)
  const request = record(payload.native_request)
  const questions = Array.isArray(request.questions) ? request.questions.map(record) : []
  const rawOptions = Array.isArray(payload.options) ? payload.options : []
  const options = rawOptions.map(record)
  const decisions =
    !rawOptions.length && Array.isArray(request.availableDecisions)
      ? request.availableDecisions
      : []
  const permission = event.permission_id
  const permissionsRequest = payload.native_method === 'item/permissions/requestApproval'
  const respond = (extra: Partial<ConnectorTarget>) =>
    onRespond({ permission_id: permission, ...extra })
  if (event.kind !== 'permission' && event.kind !== 'question') {
    const item = record(payload.item)
    const native = record(payload.native)
    const plan = Array.isArray(native.plan) ? native.plan.map(record) : []
    const changes = Array.isArray(item.changes) ? item.changes.map(record) : []
    return (
      <div className={styles.notice}>
        {typeof payload.text === 'string' && <p>{payload.text}</p>}
        {typeof item.type === 'string' && item.type !== 'agentMessage' && item.type !== 'plan' && (
          <p>
            {item.type}
            {typeof item.status === 'string' ? ` · ${item.status}` : ''}
            {typeof item.exitCode === 'number' ? ` · exit ${item.exitCode}` : ''}
          </p>
        )}
        {['command', 'tool', 'query'].map((field) =>
          typeof item[field] === 'string' ? <p key={field}>{item[field]}</p> : null,
        )}
        {!!changes.length && (
          <ul>
            {changes.map((change, index) =>
              typeof change.path === 'string' ? <li key={index}>{change.path}</li> : null,
            )}
          </ul>
        )}
        {!!plan.length && (
          <ol>
            {plan.map((step, index) =>
              typeof step.step === 'string' ? (
                <li key={index}>
                  {step.step}
                  {typeof step.status === 'string' ? ` · ${step.status}` : ''}
                </li>
              ) : null,
            )}
          </ol>
        )}
      </div>
    )
  }
  return (
    <div className={styles.group}>
      <p className={styles.notice}>
        {event.kind === 'question'
          ? t('connector:native.question')
          : t('connector:native.permission')}
      </p>
      {typeof request.command === 'string' && <p className={styles.link}>{request.command}</p>}
      {typeof request.reason === 'string' && <p className={styles.notice}>{request.reason}</p>}
      {typeof request.message === 'string' && <p className={styles.notice}>{request.message}</p>}
      {typeof request.cwd === 'string' && (
        <p className={styles.link}>{t('connector:native.cwd', { cwd: request.cwd })}</p>
      )}
      {request.additionalPermissions != null && (
        <>
          <p className={styles.notice}>{t('connector:native.additional')}</p>
          <PermissionScope value={request.additionalPermissions} />
        </>
      )}
      {permissionsRequest && (
        <>
          <PermissionScope value={request.permissions} />
          <p className={styles.notice}>{t('connector:native.turnOnly')}</p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={busy || !permission}
              onClick={() =>
                void respond({
                  response: { permissions: record(request.permissions), scope: 'turn' },
                })
              }
            >
              {t('connector:native.allowTurn')}
            </Button>
            <Button
              disabled={busy || !permission}
              onClick={() => void respond({ response: { permissions: {}, scope: 'turn' } })}
            >
              {t('connector:native.deny')}
            </Button>
          </div>
        </>
      )}
      {questions.map((question) => {
        if (typeof question.id !== 'string') return null
        const id = question.id
        const choices = Array.isArray(question.options) ? question.options.map(record) : []
        return (
          <Row key={id} title={typeof question.question === 'string' ? question.question : id}>
            {choices.length ? (
              <select
                aria-label={id}
                value={answers[id] ?? ''}
                onChange={(input) => setAnswers({ ...answers, [id]: input.target.value })}
              >
                <option value="">{t('connector:native.choose')}</option>
                {choices.map((option) =>
                  typeof option.label === 'string' ? (
                    <option key={option.label} value={option.label}>
                      {option.label}
                    </option>
                  ) : null,
                )}
              </select>
            ) : (
              <TextField
                aria-label={id}
                type={question.isSecret ? 'password' : 'text'}
                value={answers[id] ?? ''}
                onChange={(input) => setAnswers({ ...answers, [id]: input.target.value })}
              />
            )}
          </Row>
        )
      })}
      {!!questions.length && (
        <Button
          disabled={busy || !permission}
          onClick={() =>
            void respond({
              response: {
                answers: Object.fromEntries(
                  questions
                    .filter((question) => typeof question.id === 'string')
                    .map((question) => [
                      String(question.id),
                      { answers: [answers[String(question.id)] ?? ''] },
                    ]),
                ),
              },
            })
          }
        >
          {t('connector:native.submitAnswers')}
        </Button>
      )}
      <div className={styles.actions}>
        {rawOptions
          .filter((option): option is string => typeof option === 'string')
          .map((option) => (
            <Button
              key={option}
              disabled={busy || !permission}
              onClick={() => void respond({ option_id: option })}
            >
              {option}
            </Button>
          ))}
        {options.map((option) =>
          typeof option.optionId === 'string' ? (
            <Button
              key={option.optionId}
              disabled={busy || !permission}
              onClick={() => void respond({ option_id: String(option.optionId) })}
            >
              {typeof option.name === 'string' ? option.name : option.optionId}
            </Button>
          ) : null,
        )}
        {decisions.map((decision, index) => (
          <Button
            key={index}
            disabled={busy || !permission}
            onClick={() => void respond({ response: { decision } })}
          >
            {typeof decision === 'string' ? decision : JSON.stringify(decision)}
          </Button>
        ))}
      </div>
      {!permissionsRequest && !questions.length && !rawOptions.length && !decisions.length && (
        <p className={styles.notice}>{t('connector:native.noOptions')}</p>
      )}
    </div>
  )
}
