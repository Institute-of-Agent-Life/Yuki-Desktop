import { useId, useState, type ReactNode } from 'react'
import { Button, TextField } from '../components/Controls'
import { useTranslation } from '../i18n'
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
  multiple = true,
  showName = true,
}: {
  value: ConnectionDraft
  change(value: ConnectionDraft): void
  children?: ReactNode
  actions?: ReactNode
  multiple?: boolean
  showName?: boolean
}) {
  const { t } = useTranslation(['models'])
  const id = useId()
  const [model, setModel] = useState('')
  return (
    <div className={styles.formFields}>
      {showName && (
        <label className={styles.formField} htmlFor={`${id}-name`}>
          {t('models:connectionName')}
          <TextField
            id={`${id}-name`}
            value={value.name}
            onChange={(event) => change({ ...value, name: event.target.value })}
          />
        </label>
      )}
      <label className={styles.formField} htmlFor={`${id}-url`}>
        {t('models:baseUrl')}
        <TextField
          id={`${id}-url`}
          value={value.baseUrl}
          onChange={(event) => change({ ...value, baseUrl: event.target.value })}
        />
      </label>
      <label className={styles.formField} htmlFor={`${id}-key`}>
        {t('models:key')}
        <TextField
          id={`${id}-key`}
          type="password"
          autoComplete="off"
          value={value.key}
          onChange={(event) => change({ ...value, key: event.target.value })}
          placeholder={t('models:keyOptional')}
        />
      </label>
      <div className={styles.formField}>
        <label htmlFor={`${id}-model`}>{t('models:modelId')}</label>
        <div className={styles.inline}>
          <TextField
            id={`${id}-model`}
            value={multiple ? model : (value.models[0] ?? '')}
            required={!multiple}
            onChange={(event) =>
              multiple
                ? setModel(event.target.value)
                : change({ ...value, models: [event.target.value] })
            }
          />
          {multiple && (
            <Button
              onClick={() => {
                change({ ...value, models: [...new Set([...value.models, model])] })
                setModel('')
              }}
            >
              {t('models:addModel')}
            </Button>
          )}
        </div>
      </div>
      {actions}
      {multiple && value.models.length > 0 && (
        <div className={styles.checks}>
          {value.models.map((model) => (
            <Button
              key={model}
              aria-label={t('models:removeModel', { model })}
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
