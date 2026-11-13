import { useId, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
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
  Spinner,
  StatusPill,
  TextField,
  Toggle,
} from '../components/Controls'
import { ClientProblem, problemText, unwrap, useMe } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'
import { Row } from './SettingsRow'
import styles from './Platforms.module.css'

type T = ReturnType<typeof useTranslation<['platforms']>>['t']
type Credential = PlatformKey
const forms: Record<
  Credential,
  { appId: boolean; secret: 'bot_token' | 'app_secret'; sandbox: boolean }
> = {
  telegram: { appId: false, secret: 'bot_token', sandbox: false },
  feishu: { appId: true, secret: 'app_secret', sandbox: false },
  lark: { appId: true, secret: 'app_secret', sandbox: false },
  qq_official: { appId: true, secret: 'app_secret', sandbox: true },
}

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
  const data = view.data!
  const refresh = () => view.refetch()
  const card = (platform: 'telegram' | 'feishu' | 'lark') => (
    <Card
      key={platform}
      platform={platform}
      name={t(`platforms:name.${platform}`)}
      health={data.platforms[platform].health}
    >
      <CredentialForm
        id={id}
        platform={platform}
        name={t(`platforms:name.${platform}`)}
        data={data}
        refresh={refresh}
        guide={
          platform === 'telegram' ? (
            <Guide
              title={t('platforms:guide.telegram')}
              steps={(['create', 'token', 'privacy', 'webhook', 'single'] as const).map((step) =>
                t(`platforms:telegramSteps.${step}`),
              )}
            />
          ) : (
            <Guide
              title={t(`platforms:guide.${platform}`)}
              steps={(
                ['create', 'scope', 'events', 'permissions', 'publish', 'credentials'] as const
              ).map((step) =>
                t(`platforms:feishuSteps.${step}`, {
                  console: t(`platforms:${platform}Console`),
                }),
              )}
            />
          )
        }
      />
    </Card>
  )
  return (
    <div className={styles.platforms}>
      <p className={styles.intro}>{t('platforms:intro')}</p>
      {!data.writable_directory && <Banner status="failed">{t('platforms:readOnly')}</Banner>}
      {card('telegram')}
      {card('feishu')}
      {card('lark')}
      <QQCard id={id} connection={connection} data={data} refresh={refresh} onQQLogin={onQQLogin} />
    </div>
  )
}

function Card({
  platform,
  name,
  health,
  children,
}: {
  platform: string
  name: string
  health: PlatformHealth
  children: ReactNode
}) {
  const heading = useId()
  return (
    <section className={styles.card} aria-labelledby={heading} data-platform={platform}>
      <header className={styles.cardHeader}>
        <h3 id={heading}>{name}</h3>
      </header>
      <Health health={health} />
      {children}
    </section>
  )
}

function errorText(t: T, category: string) {
  return Object.hasOwn(source.errors, category) && category !== 'other'
    ? t(`platforms:errors.${category as Exclude<keyof typeof source.errors, 'other'>}`)
    : t('platforms:errors.other', { category })
}

function Health({ health }: { health: PlatformHealth }) {
  const { t } = useTranslation(['platforms'])
  const { date } = useDisplayTime()
  const state = !health.enabled
    ? 'disabled'
    : health.connected
      ? 'connected'
      : health.last_error_category
        ? 'failed'
        : 'connecting'
  return (
    <div className={styles.health}>
      <StatusPill
        status={
          state === 'connected'
            ? 'running'
            : state === 'failed'
              ? 'failed'
              : state === 'connecting'
                ? 'waiting'
                : 'offline'
        }
      >
        {t(`platforms:status.${state}`)}
      </StatusPill>
      {health.accounts.length > 0 && (
        <small>
          {t('platforms:accounts', {
            accounts: health.accounts
              .map((account) => `${account.display_name} (${account.external_account_id})`)
              .join('、'),
          })}
        </small>
      )}
      {health.last_success_at && (
        <small>{t('platforms:lastSuccess', { time: date(health.last_success_at) })}</small>
      )}
      {health.enabled && !health.connected && health.last_error_category && (
        <small>
          {t('platforms:lastError', { reason: errorText(t, health.last_error_category) })}
        </small>
      )}
    </div>
  )
}

function Guide({ title, steps }: { title: string; steps: string[] }) {
  return (
    <details className={styles.guide}>
      <summary>{title}</summary>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
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

function CredentialForm({
  id,
  platform,
  name,
  data,
  refresh,
  guide,
  beforeSave,
}: {
  id: string
  platform: Credential
  name: string
  data: PlatformsView
  refresh: () => Promise<unknown>
  guide: ReactNode
  beforeSave?: ReactNode
}) {
  const { t } = useTranslation(['platforms'])
  const field = useId()
  const form = forms[platform]
  const current: PlatformView = data.platforms[platform]
  const [appId, setAppId] = useState(String(current.settings.app_id ?? ''))
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(current.enabled)
  const [sandbox, setSandbox] = useState(current.settings.sandbox === true)
  const save = usePlatformApply(id, refresh)
  const secretSaved = current.saved_secrets.includes(form.secret)
  const settings = {
    ...(form.appId ? { app_id: appId } : {}),
    ...(form.sandbox ? { sandbox } : {}),
  }
  const blocked = !data.writable_directory || save.busy || !!save.pending
  const labels =
    platform === 'telegram'
      ? { secret: t('platforms:field.botToken') }
      : platform === 'qq_official'
        ? { appId: t('platforms:field.qqAppId'), secret: t('platforms:field.qqAppSecret') }
        : { appId: t('platforms:field.appId'), secret: t('platforms:field.appSecret') }
  return (
    <div className={styles.form}>
      {guide}
      {form.appId && (
        <div className={styles.field}>
          <label htmlFor={`${field}-app`}>{labels.appId}</label>
          <TextField
            id={`${field}-app`}
            value={appId}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setAppId(event.target.value)}
          />
        </div>
      )}
      <div className={styles.field}>
        <span className={styles.fieldLabel}>
          <label htmlFor={`${field}-secret`}>{labels.secret}</label>
          {secretSaved && <span className={styles.saved}>{t('platforms:saved')}</span>}
        </span>
        <TextField
          id={`${field}-secret`}
          type="password"
          autoComplete="off"
          value={secret}
          placeholder={secretSaved ? t('platforms:keepSaved') : undefined}
          onChange={(event) => setSecret(event.target.value)}
        />
      </div>
      {form.sandbox && (
        <div className={styles.switchRow}>
          <span>
            {t('platforms:field.sandbox')}
            <small>{t('platforms:field.sandboxDescription')}</small>
          </span>
          <Toggle label={t('platforms:field.sandbox')} checked={sandbox} onChange={setSandbox} />
        </div>
      )}
      <div className={styles.switchRow}>
        <span>{t('platforms:enable', { name })}</span>
        <Toggle label={t('platforms:enable', { name })} checked={enabled} onChange={setEnabled} />
      </div>
      {beforeSave}
      <div className={styles.actions}>
        {(current.configured || current.saved_secrets.length > 0) && (
          <Button
            variant="plain"
            disabled={blocked}
            onClick={() =>
              save.apply(
                {
                  expectedRevision: data.revision,
                  platform,
                  enabled: false,
                  settings: form.appId ? { app_id: '' } : {},
                  secrets: { [form.secret]: '' },
                },
                () => {
                  setAppId('')
                  setSecret('')
                  setEnabled(false)
                },
              )
            }
          >
            {t('platforms:removeCredentials')}
          </Button>
        )}
        <Button
          variant="primary"
          loading={save.busy}
          disabled={blocked}
          onClick={() =>
            save.apply(
              {
                expectedRevision: data.revision,
                platform,
                enabled,
                settings,
                secrets: secret ? { [form.secret]: secret } : {},
              },
              () => setSecret(''),
            )
          }
        >
          {t('platforms:save')}
        </Button>
      </div>
      <SaveFeedback save={save} refresh={refresh} />
    </div>
  )
}

function SaveFeedback({
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
        <p role="status" className={styles.done}>
          {t(outcome.kind === 'applied' ? 'platforms:applied' : 'platforms:savedPendingRestart')}
        </p>
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
          <span className={styles.failure}>
            {outcome.text}
            {outcome.code !== undefined && (
              <small>{t('platforms:platformCode', { code: outcome.code })}</small>
            )}
          </span>
        </Banner>
      ) : null}
    </>
  )
}

function QQCard({
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
  const official = data.platforms.qq_official,
    onebot = data.platforms.qq
  const [mode, setMode] = useState<'official' | 'snowluma'>(
    !official.configured && (onebot.login_available || onebot.health.connected)
      ? 'snowluma'
      : 'official',
  )
  const heading = useId(),
    limits = useId()
  return (
    <section className={styles.card} aria-labelledby={heading} data-platform="qq">
      <header className={styles.cardHeader}>
        <h3 id={heading}>{t('platforms:name.qq')}</h3>
        <Segmented
          kind="radio"
          label={t('platforms:qqMode')}
          value={mode}
          items={[
            { value: 'official', label: t('platforms:qqOfficial') },
            { value: 'snowluma', label: t('platforms:snowluma') },
          ]}
          onChange={setMode}
        />
      </header>
      {mode === 'official' ? (
        <>
          <Health health={official.health} />
          <p className={styles.description}>{t('platforms:qqOfficialDescription')}</p>
          <CredentialForm
            id={id}
            platform="qq_official"
            name={t('platforms:qqOfficial')}
            data={data}
            refresh={refresh}
            guide={
              <Guide
                title={t('platforms:guide.qqOfficial')}
                steps={(
                  ['register', 'credentials', 'whitelist', 'sandbox', 'release'] as const
                ).map((step) => t(`platforms:qqSteps.${step}`))}
              />
            }
            beforeSave={
              <div className={styles.limits}>
                <h4 id={limits}>{t('platforms:limitsTitle')}</h4>
                <ul aria-labelledby={limits}>
                  {(['mentions', 'proactive', 'window', 'identity'] as const).map((item) => (
                    <li key={item}>{t(`platforms:limits.${item}`)}</li>
                  ))}
                </ul>
              </div>
            }
          />
        </>
      ) : (
        <>
          <Health health={onebot.health} />
          <SnowLuma
            connection={connection}
            loginAvailable={onebot.login_available}
            onQQLogin={onQQLogin}
            refresh={refresh}
          />
        </>
      )}
    </section>
  )
}

function SnowLuma({
  connection,
  loginAvailable,
  onQQLogin,
  refresh,
}: {
  connection: Connection
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
    <div className={styles.form}>
      <p className={styles.description}>{t('platforms:snowlumaDescription')}</p>
      {loginAvailable ? (
        <Row title={t('platforms:qqLogin')} description={t('platforms:qqLoginDescription')}>
          <Button onClick={onQQLogin}>{t('platforms:openQQLogin')}</Button>
        </Row>
      ) : (
        <p className={styles.description}>{t('platforms:qqLoginUnavailable')}</p>
      )}
      <div className={styles.field}>
        <label htmlFor={`${field}-image`}>{t('platforms:image')}</label>
        <TextField
          id={`${field}-image`}
          value={image}
          spellCheck={false}
          autoComplete="off"
          placeholder={t('platforms:imagePlaceholder')}
          onChange={(event) => setImage(event.target.value)}
        />
      </div>
      {local.isPending ? (
        <Spinner />
      ) : here ? (
        <Row title={t('platforms:enableLocal')} description={t('platforms:enableLocalDescription')}>
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
                    failure instanceof ClientProblem ? problemText(failure.code) : String(failure),
                })
              } finally {
                setBusy(false)
              }
            }}
          >
            {t('platforms:enableLocal')}
          </Button>
        </Row>
      ) : (
        <div className={styles.commands}>
          <p className={styles.description}>{t('platforms:serverCommands')}</p>
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
      {notice &&
        (notice.failed ? (
          <Banner status="failed">{notice.text}</Banner>
        ) : (
          <p role="status" className={styles.done}>
            {notice.text}
          </p>
        ))}
      <p className={styles.description}>{t('platforms:elsewhere')}</p>
    </div>
  )
}
