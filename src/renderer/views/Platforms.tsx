import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, Copy } from 'lucide-react'
import type { Connection } from '../../shared/api'
import {
  PLATFORMS_API_REVISION,
  type PlatformApplyInput,
  type PlatformHealth,
  type PlatformKey,
  type PlatformView,
  type PlatformsView,
} from '../../shared/platforms'
import { snowLumaServerScript } from '../../shared/snowluma'
import source from '../../shared/locales/zh-Hant/platforms'
import {
  Banner,
  Button,
  Segmented,
  Sheet,
  Spinner,
  TextField,
  Toggle,
} from '../components/Controls'
import { ClientProblem, problemText, unwrap, useMe } from '../queries/client'
import { useTranslation } from '../i18n'
import { Row, SettingsSection } from './SettingsRow'
import settings from './Settings.module.css'
import form from './ModelSettings.module.css'
import styles from './Platforms.module.css'

type T = ReturnType<typeof useTranslation<['platforms']>>['t']
type Credential = PlatformKey
type Editable = 'telegram' | 'feishu' | 'lark' | 'qq'
type QQMode = 'official' | 'snowluma'
const forms: Record<
  Credential,
  { appId: boolean; secret: 'bot_token' | 'app_secret'; sandbox: boolean }
> = {
  telegram: { appId: false, secret: 'bot_token', sandbox: false },
  feishu: { appId: true, secret: 'app_secret', sandbox: false },
  lark: { appId: true, secret: 'app_secret', sandbox: false },
  qq_official: { appId: true, secret: 'app_secret', sandbox: true },
}
// Where each platform's credentials are made.
const consoles: Record<Credential, string> = {
  telegram: 'https://t.me/BotFather',
  feishu: 'https://open.feishu.cn/app',
  lark: 'https://open.larksuite.com/app',
  qq_official: 'https://q.qq.com',
}

interface Draft {
  appId: string
  secret: string
  enabled: boolean
  sandbox: boolean
}
const draftOf = (view: PlatformView): Draft => ({
  appId: String(view.settings.app_id ?? ''),
  secret: '',
  enabled: view.enabled,
  sandbox: view.settings.sandbox === true,
})
const settingsOf = (platform: Credential, draft: Draft) => ({
  ...(forms[platform].appId ? { app_id: draft.appId } : {}),
  ...(forms[platform].sandbox ? { sandbox: draft.sandbox } : {}),
})

export function Platforms({
  connection,
  onQQLogin,
}: {
  connection: Connection
  onQQLogin(): void
}) {
  const { t } = useTranslation(['platforms'])
  const id = connection.characterId
  const authority = useMe(id)
  const view = useQuery({
    queryKey: ['desktop', 'platforms', id],
    queryFn: () => window.yuki.client.platforms.read(id).then(unwrap),
    retry: false,
  })
  const problem = view.error instanceof ClientProblem ? view.error : undefined
  if (problem?.code === 'server_upgrade_required')
    return (
      <Banner status="failed">
        {t('platforms:revisionUnavailable', {
          revision: problem.reason!,
          required: PLATFORMS_API_REVISION,
        })}
      </Banner>
    )
  if (authority.data?.is_superuser === false || problem?.code === 'capability_denied')
    return <Banner>{t('platforms:adminOnly')}</Banner>
  if (authority.error) return <Banner status="failed">{authority.error.message}</Banner>
  if (authority.isPending || view.isPending) return <Spinner />
  if (view.error) return <Banner status="failed">{view.error.message}</Banner>
  return (
    <PlatformList
      id={id}
      connection={connection}
      data={view.data!}
      refresh={() => view.refetch()}
      onQQLogin={onQQLogin}
    />
  )
}

function errorText(t: T, category: string) {
  return Object.hasOwn(source.errors, category) && category !== 'other'
    ? t(`platforms:errors.${category as Exclude<keyof typeof source.errors, 'other'>}`)
    : t('platforms:errors.other', { category })
}

// One line under the platform's name: who it is connected as, why it is not, or that it is off.
function summary(t: T, health: PlatformHealth, configured: boolean) {
  if (!health.enabled) return t(configured ? 'platforms:status.disabled' : 'platforms:status.unset')
  if (health.connected)
    return health.accounts.length
      ? t('platforms:connectedAs', {
          accounts: health.accounts
            .map((account) => account.display_name || account.external_account_id)
            .join(t('platforms:accountSeparator')),
        })
      : t('platforms:status.connected')
  if (health.last_error_category) return errorText(t, health.last_error_category)
  return t('platforms:status.connecting')
}

function steps(t: T, platform: Credential) {
  if (platform === 'telegram')
    return (['create', 'token', 'privacy', 'webhook'] as const).map((step) =>
      t(`platforms:telegramSteps.${step}`),
    )
  if (platform === 'qq_official')
    return (['register', 'credentials', 'sandbox', 'release'] as const).map((step) =>
      t(`platforms:qqSteps.${step}`),
    )
  return (['create', 'events', 'permissions', 'publish', 'credentials'] as const).map((step) =>
    t(`platforms:feishuSteps.${step}`, { console: t(`platforms:${platform}Console`) }),
  )
}

type Outcome =
  | { kind: 'applied' | 'restart' | 'conflict' | 'notApplied' }
  | { kind: 'failed'; text: string; code?: number }

function usePlatformApply(id: string, refresh: () => Promise<unknown>) {
  const { t } = useTranslation(['platforms'])
  const [pending, setPending] = useState<{ input: PlatformApplyInput; saved(): void }>()
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>()
  const run = async (request: NonNullable<typeof pending>) => {
    setBusy(true)
    setOutcome(undefined)
    try {
      const result = unwrap(await window.yuki.client.platforms.apply(id, request.input))
      setPending(undefined)
      if (result.success) {
        request.saved()
        setOutcome({
          kind: result.effective_state.status === 'saved_pending_restart' ? 'restart' : 'applied',
        })
      } else setOutcome({ kind: 'notApplied' })
      await refresh()
    } catch (error) {
      const failure = error as ClientProblem
      // Only an unanswered request is checked again, under its original request ID.
      if (['transport_unknown', 'unknown'].includes(failure.code)) return
      setPending(undefined)
      if (failure.code === 'version_conflict') setOutcome({ kind: 'conflict' })
      else if (failure.code === 'precondition_failed') {
        // The platform's own facts come with the first answer only; a replay may lack them.
        const facts = (failure.details?.details ?? {}) as {
          error_category?: string
          error_code?: number
        }
        setOutcome({
          kind: 'failed',
          text: facts.error_category
            ? errorText(t, facts.error_category)
            : t('platforms:preflightFailed'),
          code: facts.error_code,
        })
      } else
        setOutcome({
          kind: 'failed',
          text:
            failure.code === 'validation_error' ||
            failure.code === 'operation_unavailable' ||
            failure.code === 'capability_denied'
              ? t(`platforms:problem.${failure.code}`)
              : t('platforms:problem.other', { code: failure.code }),
        })
    } finally {
      setBusy(false)
    }
  }
  const apply = (input: Omit<PlatformApplyInput, 'requestId'>, saved: () => void) => {
    const request = { input: { ...input, requestId: crypto.randomUUID() }, saved }
    setPending(request)
    void run(request)
  }
  return {
    apply,
    busy,
    pending,
    outcome,
    verify: () => void run(pending!),
    clear: () => setOutcome(undefined),
  }
}

function PlatformList({
  id,
  connection,
  data,
  refresh,
  onQQLogin,
}: {
  id: string
  connection: Connection
  data: PlatformsView
  refresh: () => Promise<unknown>
  onQQLogin(): void
}) {
  const { t } = useTranslation(['platforms'])
  const save = usePlatformApply(id, refresh)
  const [editing, setEditing] = useState<{ platform: Editable; mode: QQMode; draft: Draft }>()
  const blocked = !data.writable_directory || save.busy || !!save.pending
  const official = data.platforms.qq_official,
    onebot = data.platforms.qq
  const credential: Credential | undefined =
    editing?.platform === 'qq'
      ? editing.mode === 'official'
        ? 'qq_official'
        : undefined
      : editing?.platform
  const open = (platform: Editable) => {
    save.clear()
    setEditing({
      platform,
      mode:
        platform === 'qq' &&
        !official.configured &&
        (onebot.login_available || onebot.health.connected)
          ? 'snowluma'
          : 'official',
      draft: draftOf(data.platforms[platform === 'qq' ? 'qq_official' : platform]),
    })
  }
  const close = () => {
    if (!save.busy && !save.pending) setEditing(undefined)
  }
  const apply = (input: Omit<PlatformApplyInput, 'requestId' | 'expectedRevision'>) =>
    save.apply({ ...input, expectedRevision: data.revision }, () => setEditing(undefined))
  const feedback = <Feedback save={save} refresh={refresh} />
  const controls = (platform: Credential, title: string, name: string) => {
    const view = data.platforms[platform]
    return (
      <>
        {view.configured && (
          <Toggle
            label={t('platforms:enable', { name })}
            checked={view.enabled}
            disabled={blocked}
            onChange={(enabled) =>
              apply({
                platform,
                enabled,
                settings: settingsOf(platform, draftOf(view)),
                secrets: {},
              })
            }
          />
        )}
        <Button
          aria-label={t('platforms:configureName', { name: title })}
          onClick={() => open(platform === 'qq_official' ? 'qq' : platform)}
        >
          {t('platforms:configure')}
        </Button>
      </>
    )
  }
  const qqSummary = official.configured
    ? t('platforms:qqSummary', {
        mode: t('platforms:qqOfficial'),
        status: summary(t, official.health, true),
      })
    : onebot.health.enabled
      ? t('platforms:qqSummary', {
          mode: t('platforms:snowluma'),
          status: summary(t, onebot.health, true),
        })
      : t('platforms:status.unset')
  const name = editing && t(`platforms:name.${editing.platform}`)
  return (
    <>
      <div className={styles.platforms}>
        <p className={settings.notice}>{t('platforms:intro')}</p>
        <SettingsSection>
          {!data.writable_directory && <Banner status="failed">{t('platforms:readOnly')}</Banner>}
          {!editing && feedback}
          {(['telegram', 'feishu', 'lark'] as const).map((platform) => {
            const view = data.platforms[platform],
              title = t(`platforms:name.${platform}`)
            return (
              <Row
                key={platform}
                group
                title={title}
                description={summary(t, view.health, view.configured)}
              >
                {controls(platform, title, title)}
              </Row>
            )
          })}
          <Row group title={t('platforms:name.qq')} description={qqSummary}>
            {controls('qq_official', t('platforms:name.qq'), t('platforms:qqOfficial'))}
          </Row>
        </SettingsSection>
      </div>
      <Sheet
        title={name ?? ''}
        open={!!editing}
        width={560}
        onClose={close}
        actions={
          credential ? (
            <>
              <Button disabled={save.busy || !!save.pending} onClick={close}>
                {t('platforms:cancel')}
              </Button>
              <Button
                variant="primary"
                loading={save.busy}
                disabled={blocked}
                onClick={() =>
                  apply({
                    platform: credential,
                    enabled: editing!.draft.enabled,
                    settings: settingsOf(credential, editing!.draft),
                    secrets: editing!.draft.secret
                      ? { [forms[credential].secret]: editing!.draft.secret }
                      : {},
                  })
                }
              >
                {t('platforms:save')}
              </Button>
            </>
          ) : (
            <Button onClick={close}>{t('platforms:done')}</Button>
          )
        }
      >
        {editing && (
          <>
            {editing.platform === 'qq' && (
              <div className={styles.mode}>
                <Segmented
                  kind="radio"
                  label={t('platforms:qqMode')}
                  value={editing.mode}
                  disabled={save.busy || !!save.pending}
                  items={[
                    { value: 'official', label: t('platforms:qqOfficial') },
                    { value: 'snowluma', label: t('platforms:snowluma') },
                  ]}
                  onChange={(mode) => setEditing({ ...editing, mode })}
                />
              </div>
            )}
            {credential ? (
              <>
                <CredentialFields
                  platform={credential}
                  view={data.platforms[credential]}
                  draft={editing.draft}
                  change={(draft) => setEditing({ ...editing, draft })}
                  disabled={save.busy || !!save.pending}
                  remove={
                    blocked
                      ? undefined
                      : () =>
                          apply({
                            platform: credential,
                            enabled: false,
                            settings: forms[credential].appId ? { app_id: '' } : {},
                            secrets: { [forms[credential].secret]: '' },
                          })
                  }
                />
                {feedback}
              </>
            ) : (
              <SnowLuma
                connection={connection}
                health={onebot.health}
                loginAvailable={onebot.login_available}
                onQQLogin={() => {
                  setEditing(undefined)
                  onQQLogin()
                }}
                refresh={refresh}
              />
            )}
          </>
        )}
      </Sheet>
    </>
  )
}

function CredentialFields({
  platform,
  view,
  draft,
  change,
  disabled,
  remove,
}: {
  platform: Credential
  view: PlatformView
  draft: Draft
  change(draft: Draft): void
  disabled: boolean
  /** Absent while a save cannot go through. */
  remove?: () => void
}) {
  const { t } = useTranslation(['platforms'])
  const limits = useId()
  const shape = forms[platform]
  const name =
    platform === 'qq_official' ? t('platforms:qqOfficial') : t(`platforms:name.${platform}`)
  const labels =
    platform === 'telegram'
      ? { appId: '', secret: t('platforms:field.botToken') }
      : platform === 'qq_official'
        ? { appId: t('platforms:field.qqAppId'), secret: t('platforms:field.qqAppSecret') }
        : { appId: t('platforms:field.appId'), secret: t('platforms:field.appSecret') }
  return (
    <div className={styles.body}>
      {platform === 'qq_official' && (
        <div className={styles.limits}>
          <strong id={limits}>{t('platforms:limitsTitle')}</strong>
          <ul aria-labelledby={limits}>
            {(['mentions', 'replies', 'identity'] as const).map((item) => (
              <li key={item}>{t(`platforms:limits.${item}`)}</li>
            ))}
          </ul>
        </div>
      )}
      <details className={styles.howTo}>
        <summary>{t('platforms:howTo')}</summary>
        <ol>
          {steps(t, platform).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Button
          variant="plain"
          onClick={() => void window.yuki.client.external(consoles[platform])}
        >
          {t(`platforms:console.${platform}`)} <ArrowUpRight size={14} />
        </Button>
      </details>
      <fieldset className={`${form.editor} ${form.formFields}`} disabled={disabled}>
        {shape.appId && (
          <label className={form.formField}>
            {labels.appId}
            <TextField
              value={draft.appId}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => change({ ...draft, appId: event.target.value })}
            />
          </label>
        )}
        <label className={form.formField}>
          {labels.secret}
          <TextField
            type="password"
            autoComplete="off"
            value={draft.secret}
            placeholder={
              view.saved_secrets.includes(shape.secret) ? t('platforms:saved') : undefined
            }
            onChange={(event) => change({ ...draft, secret: event.target.value })}
          />
        </label>
        {shape.sandbox && (
          <div className={form.formRow}>
            <span className={form.formField}>
              {t('platforms:field.sandbox')}
              <small>{t('platforms:field.sandboxDescription')}</small>
            </span>
            <Toggle
              label={t('platforms:field.sandbox')}
              checked={draft.sandbox}
              onChange={(sandbox) => change({ ...draft, sandbox })}
            />
          </div>
        )}
        <div className={form.formRow}>
          <span>{t('platforms:enable', { name })}</span>
          <Toggle
            label={t('platforms:enable', { name })}
            checked={draft.enabled}
            onChange={(enabled) => change({ ...draft, enabled })}
          />
        </div>
      </fieldset>
      {(view.configured || view.saved_secrets.length > 0) && (
        <Button variant="plain" disabled={!remove} onClick={remove}>
          {t('platforms:removeCredentials')}
        </Button>
      )}
    </div>
  )
}

function Feedback({
  save,
  refresh,
}: {
  save: ReturnType<typeof usePlatformApply>
  refresh: () => Promise<unknown>
}) {
  const { t } = useTranslation(['platforms'])
  const [reloading, setReloading] = useState(false)
  const outcome = save.outcome
  return (
    <>
      {save.pending && !save.busy && (
        <Row title={t('platforms:pending')} description={t('platforms:pendingDescription')}>
          <Button onClick={save.verify}>{t('platforms:verify')}</Button>
        </Row>
      )}
      {outcome?.kind === 'applied' || outcome?.kind === 'restart' ? (
        <Banner status="done">
          {t(outcome.kind === 'applied' ? 'platforms:applied' : 'platforms:savedPendingRestart')}
        </Banner>
      ) : outcome?.kind === 'notApplied' ? (
        <Banner status="failed">{t('platforms:notApplied')}</Banner>
      ) : outcome?.kind === 'conflict' ? (
        <Banner status="failed">
          {t('platforms:conflict')}
          <Button
            loading={reloading}
            onClick={async () => {
              setReloading(true)
              await refresh()
              setReloading(false)
              save.clear()
            }}
          >
            {t('platforms:reload')}
          </Button>
        </Banner>
      ) : outcome?.kind === 'failed' ? (
        <Banner status="failed">
          {outcome.text}
          {outcome.code !== undefined && (
            <span>{t('platforms:platformCode', { code: outcome.code })}</span>
          )}
        </Banner>
      ) : null}
    </>
  )
}

function SnowLuma({
  connection,
  health,
  loginAvailable,
  onQQLogin,
  refresh,
}: {
  connection: Connection
  health: PlatformHealth
  loginAvailable: boolean
  onQQLogin(): void
  refresh: () => Promise<unknown>
}) {
  const { t } = useTranslation(['platforms'])
  const field = useId()
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ failed: boolean; text: string }>()
  const local = useQuery({
    queryKey: ['desktop', 'local-bot-state'],
    queryFn: () => window.yuki.localBot.state().then(unwrap),
    retry: false,
  })
  const here = local.data?.installation?.address === connection.baseUrl
  const script = snowLumaServerScript(image.trim() || t('platforms:imagePlaceholder'))
  return (
    <>
      <div className={styles.body}>
        <p className={styles.note}>{t('platforms:snowlumaDescription')}</p>
        <div className={form.formRow}>
          <span>{t('platforms:snowlumaStatus')}</span>
          <span className={styles.note}>{summary(t, health, false)}</span>
        </div>
        {loginAvailable ? (
          <div className={form.formRow}>
            <span className={form.formField}>
              {t('platforms:qqLogin')}
              <small>{t('platforms:qqLoginDescription')}</small>
            </span>
            <Button onClick={onQQLogin}>{t('platforms:openQQLogin')}</Button>
          </div>
        ) : (
          <p className={styles.note}>{t('platforms:qqLoginUnavailable')}</p>
        )}
        <div className={form.formField}>
          <label htmlFor={`${field}-image`}>{t('platforms:image')}</label>
          <TextField
            id={`${field}-image`}
            value={image}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('platforms:imagePlaceholder')}
            onChange={(event) => setImage(event.target.value)}
          />
          <small>{t('platforms:imageDescription')}</small>
        </div>
        {local.isPending ? (
          <Spinner />
        ) : here ? (
          <div className={form.formRow}>
            <span className={styles.note}>{t('platforms:enableLocalDescription')}</span>
            <Button
              variant="primary"
              loading={busy}
              disabled={!image.trim()}
              onClick={async () => {
                setBusy(true)
                setNotice(undefined)
                try {
                  unwrap(await window.yuki.localBot.enableSnowLuma(image))
                  setNotice({ failed: false, text: t('platforms:enabledLocal') })
                  await refresh()
                } catch (failure) {
                  setNotice({
                    failed: true,
                    text:
                      failure instanceof ClientProblem
                        ? problemText(failure.code)
                        : String(failure),
                  })
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('platforms:enableLocal')}
            </Button>
          </div>
        ) : (
          <div className={styles.commands}>
            <p className={styles.note}>{t('platforms:serverCommands')}</p>
            <code>{script}</code>
            <Button
              variant="plain"
              onClick={async () => {
                setNotice(undefined)
                unwrap(await window.yuki.client.copy(script))
                setNotice({ failed: false, text: t('platforms:copied') })
              }}
            >
              <Copy size={14} /> {t('platforms:copyCommands')}
            </Button>
          </div>
        )}
        <details className={styles.howTo}>
          <summary>{t('platforms:elsewhereTitle')}</summary>
          <p className={styles.note}>{t('platforms:elsewhere')}</p>
        </details>
      </div>
      {notice && <Banner status={notice.failed ? 'failed' : 'done'}>{notice.text}</Banner>}
    </>
  )
}
