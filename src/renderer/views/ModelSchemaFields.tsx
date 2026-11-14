import { useId } from 'react'
import type { TFunction } from 'i18next'
import { Button, TextField, Toggle } from '../components/Controls'
import { useTranslation } from '../i18n'
import source from '../../shared/locales/zh-Hant/models'
import styles from './ModelSettings.module.css'

export interface JsonSchema {
  $ref?: string
  $defs?: Record<string, JsonSchema>
  type?: string
  title?: string
  default?: unknown
  enum?: (string | number)[]
  const?: unknown
  anyOf?: JsonSchema[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
}

function modelLabel(t: TFunction<['models']>, name: string) {
  return Object.hasOwn(source.field, name)
    ? t(`models:field.${name as keyof typeof source.field}`)
    : name
}

export function schemaDefaults(schema: JsonSchema): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema.properties!)
      .filter(([, field]) => field.default !== undefined && field.default !== null)
      .map(([name, field]) => [name, field.default]),
  )
}

function Field({
  name,
  source,
  root,
  value,
  change,
  required,
}: {
  name: string
  source: JsonSchema
  root: JsonSchema
  value: unknown
  change(value: unknown): void
  required: boolean
}) {
  const { t } = useTranslation(['models'])
  const id = useId()
  const resolved = source.$ref ? root.$defs![source.$ref.split('/').at(-1)!]! : source
  const nullable = resolved.anyOf?.some((field) => field.type === 'null') === true
  const nonNull = resolved.anyOf ? resolved.anyOf.find((field) => field.type !== 'null')! : resolved
  const schema = nonNull.$ref ? root.$defs![nonNull.$ref.split('/').at(-1)!]! : nonNull
  const current = value === undefined ? resolved.default : value
  const title = modelLabel(t, name)
  if (schema.type === 'array') {
    const item = schema.items!.$ref
      ? root.$defs![schema.items!.$ref.split('/').at(-1)!]!
      : schema.items!
    return (
      <fieldset className={styles.fieldset}>
        <legend>{title}</legend>
        <div className={styles.checks}>
          {item.enum!.map((option) => (
            <label key={option}>
              <input
                type="checkbox"
                checked={(current as string[] | undefined)?.includes(String(option)) === true}
                onChange={(event) =>
                  change(
                    event.target.checked
                      ? [...((current as string[] | undefined) ?? []), option]
                      : (current as string[]).filter((value) => value !== option),
                  )
                }
              />
              {modelLabel(t, String(option))}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  if (schema.type === 'object')
    return (
      <details className={styles.advanced}>
        <summary>{title}</summary>
        {nullable && (
          <Button onClick={() => change(current == null ? schemaDefaults(schema) : null)}>
            {t(current == null ? 'models:set' : 'models:unset')}
          </Button>
        )}
        {current != null && (
          <ModelSchemaFields
            schema={schema}
            root={root}
            value={current as Record<string, unknown>}
            change={change}
          />
        )}
      </details>
    )
  if (schema.type === 'boolean' && !nullable)
    return (
      <div className={styles.formRow}>
        <span>{title}</span>
        <Toggle label={title} checked={current === true} onChange={change} />
      </div>
    )
  return (
    <label className={styles.formField} htmlFor={id}>
      <span>
        {title}
        {required && <small aria-hidden="true">{t('models:required')}</small>}
      </span>
      {schema.enum || schema.const !== undefined || schema.type === 'boolean' ? (
        <select
          id={id}
          aria-label={title}
          value={current == null ? '' : String(current)}
          onChange={(event) =>
            change(
              event.target.value === ''
                ? null
                : schema.type === 'boolean'
                  ? event.target.value === 'true'
                  : event.target.value,
            )
          }
        >
          {(nullable || current == null) && <option value="">{t('models:unset')}</option>}
          {(schema.enum ?? (schema.const !== undefined ? [schema.const] : ['true', 'false'])).map(
            (option) => (
              <option key={String(option)} value={String(option)}>
                {String(option)}
              </option>
            ),
          )}
        </select>
      ) : (
        <TextField
          id={id}
          aria-label={title}
          type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
          step={schema.type === 'integer' ? '1' : 'any'}
          value={current == null ? '' : String(current)}
          onChange={(event) =>
            change(
              event.target.value === '' && nullable
                ? null
                : schema.type === 'number' || schema.type === 'integer'
                  ? event.target.value === ''
                    ? undefined
                    : Number(event.target.value)
                  : event.target.value,
            )
          }
        />
      )}
    </label>
  )
}

export function ModelSchemaFields({
  schema,
  root = schema,
  value,
  change,
  fields = Object.keys(schema.properties!),
  effective,
}: {
  schema: JsonSchema
  root?: JsonSchema
  value: Record<string, unknown>
  change(value: Record<string, unknown>): void
  fields?: string[]
  effective?: Record<string, unknown>
}) {
  return (
    <div className={styles.formFields}>
      {fields
        .filter((name) => !['id', 'headers'].includes(name))
        .map((name) => (
          <Field
            key={name}
            name={name}
            source={schema.properties![name]!}
            root={root}
            value={
              effective && name in effective && value[`${name}_env`] ? effective[name] : value[name]
            }
            required={schema.required?.includes(name) === true}
            change={(next) => {
              const updated = { ...value, [name]: next }
              if (next == null) delete updated[name]
              if (['base_url', 'model', 'reasoning_effort'].includes(name))
                delete updated[`${name}_env`]
              if (name === 'thinking_enabled') delete updated.thinking_mode
              change(updated)
            }}
          />
        ))}
    </div>
  )
}
