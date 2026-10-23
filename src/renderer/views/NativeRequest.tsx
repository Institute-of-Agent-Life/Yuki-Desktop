import { useState } from 'react'
import type { ConnectorOperation, ConnectorTarget } from '../../shared/connector'
import { Button, TextField } from '../components/Controls'
import { Row } from './Settings'
import styles from './Settings.module.css'

type Event = NonNullable<ConnectorOperation['events']>[number]
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
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
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const payload = record(event.payload)
  const request = record(payload.native_request)
  const questions = Array.isArray(request.questions) ? request.questions.map(record) : []
  const rawOptions = Array.isArray(payload.options) ? payload.options : []
  const options = rawOptions.map(record)
  const decisions = Array.isArray(request.availableDecisions) ? request.availableDecisions : []
  const permission = event.permission_id
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
        {event.kind === 'question' ? '原生 Agent 的問題' : '原生 Agent 的權限要求'}
      </p>
      {typeof request.command === 'string' && <p className={styles.link}>{request.command}</p>}
      {typeof request.reason === 'string' && <p className={styles.notice}>{request.reason}</p>}
      {typeof request.message === 'string' && <p className={styles.notice}>{request.message}</p>}
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
                <option value="">請選擇</option>
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
          提交原問題回覆
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
      {!questions.length && !rawOptions.length && !decisions.length && (
        <p className={styles.notice}>這項原生請求沒有提供可選回覆，請回原生程式處理。</p>
      )}
    </div>
  )
}
