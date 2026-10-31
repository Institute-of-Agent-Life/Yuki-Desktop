import { useId, useState, type ReactNode } from 'react'
import { Button, TextField } from '../components/Controls'
import styles from './ModelSettings.module.css'

export interface ConnectionDraft {
  name: string
  baseUrl: string
  key: string
  models: string[]
}

export function ModelConnectionForm({
  value,
  change,
  children,
  actions,
}: {
  value: ConnectionDraft
  change(value: ConnectionDraft): void
  children?: ReactNode
  actions?: ReactNode
}) {
  const id = useId()
  const [model, setModel] = useState('')
  return (
    <div className={styles.formFields}>
      <label className={styles.formField} htmlFor={`${id}-name`}>
        連接名稱
        <TextField
          id={`${id}-name`}
          value={value.name}
          onChange={(event) => change({ ...value, name: event.target.value })}
        />
      </label>
      <label className={styles.formField} htmlFor={`${id}-url`}>
        服務位址
        <TextField
          id={`${id}-url`}
          value={value.baseUrl}
          onChange={(event) => change({ ...value, baseUrl: event.target.value })}
        />
      </label>
      <label className={styles.formField} htmlFor={`${id}-key`}>
        金鑰
        <TextField
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          value={value.key}
          onChange={(event) => change({ ...value, key: event.target.value })}
          placeholder="不需鑑權時留空"
        />
      </label>
      <div className={styles.formField}>
        <label htmlFor={`${id}-model`}>模型 ID</label>
        <div className={styles.inline}>
          <TextField
            id={`${id}-model`}
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
          <Button
            onClick={() => {
              change({ ...value, models: [...new Set([...value.models, model])] })
              setModel('')
            }}
          >
            加入模型
          </Button>
        </div>
      </div>
      {actions}
      {value.models.length > 0 && (
        <div className={styles.checks}>
          {value.models.map((model) => (
            <Button
              key={model}
              aria-label={`移除模型 ${model}`}
              variant="plain"
              onClick={() =>
                change({ ...value, models: value.models.filter((id) => id !== model) })
              }
            >
              {model} ×
            </Button>
          ))}
        </div>
      )}
      {children}
    </div>
  )
}
