import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import type {
  Computer as ComputerState,
  ComputerCommand,
  ComputerCommandItem,
} from '../../shared/api'
import { formatBytes } from '../../shared/media'
import { Banner, Button, IconButton, Sheet, TextField } from '../components/Controls'
import { problemText, unwrap } from '../queries/client'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'
import { Row, SettingsSection } from './SettingsRow'
import settings from './Settings.module.css'
import styles from './Computer.module.css'

type Snapshot = NonNullable<ComputerState['snapshots']>[number]
/** What the Bot found this restore would interrupt, when it refused it unconfirmed. */
interface Interrupted {
  tabs: ComputerState['tabs']
  runs: { run_id: string; status: string }[]
  control: ComputerState['control']
}
const activeTabs = (tabs: ComputerState['tabs']) =>
  tabs.filter(
    (tab) =>
      tab.ownership === 'work' &&
      !['completed', 'failed', 'cancelled'].includes(tab.work_state ?? ''),
  )

/** The whole computer's restore points: the list, "建立快照" and each one's "還原到此". */
export function ComputerSnapshots({
  id,
  name,
  state,
  snapshots,
  blocked,
}: {
  id: string
  name: string
  state: ComputerState
  snapshots: Snapshot[]
  blocked: boolean
}) {
  const { t } = useTranslation(['computer', 'common', 'errors'])
  const { date } = useDisplayTime()
  const client = useQueryClient()
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [problem, setProblem] = useState(''),
    [restoring, setRestoring] = useState<Snapshot | null>(null),
    [interrupted, setInterrupted] = useState<Interrupted | null>(null)
  // One snapshot or restore at a time: the Manager answers another with the one in progress.
  const working =
    snapshots.some((snapshot) => snapshot.state === 'creating') ||
    state.last_restore?.state === 'accepted'
  const run = async (command: ComputerCommand) => {
    setBusy(true)
    setProblem('')
    try {
      const result = unwrap(await window.yuki.client.computerCommand(id, command))
      client.setQueryData<ComputerCommandItem[]>([id, 'computer-commands'], (previous) => [
        ...(previous ?? []).filter((item) => item.requestId !== result.requestId),
        result,
      ])
      if (result.problem)
        setProblem(
          result.state === 'submitted' ? t('computer:unconfirmed') : problemText(result.problem),
        )
      return result
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t('errors:notCompleted'))
    } finally {
      setBusy(false)
      void client.invalidateQueries({ queryKey: [id, 'computer'] })
      void client.invalidateQueries({ queryKey: [id, 'computer-commands'] })
    }
  }
  const create = async () => {
    const text = note.trim()
    const result = await run({ action: 'snapshot', ...(text ? { note: text } : {}) })
    if (result && !result.problem) setNote('')
  }
  const restore = async () => {
    const result = await run({
      action: 'restore',
      snapshotId: restoring!.id,
      confirmActiveWork: interrupted !== null,
    })
    if (result?.problem === 'precondition_failed' && interrupted === null) {
      setProblem('')
      setInterrupted(result.details as unknown as Interrupted)
    } else if (result && !result.problem) {
      setRestoring(null)
      setOpen(false)
    }
  }
  const sources = {
    daily: t('computer:snapshots.source.daily'),
    yuki: name,
    person: t('computer:snapshots.source.person'),
  }
  const describe = (snapshot: Snapshot) =>
    [
      sources[snapshot.source],
      snapshot.state === 'creating'
        ? t('computer:snapshots.creating')
        : snapshot.state === 'failed'
          ? t('computer:snapshots.failed', { error: snapshot.error ?? '' })
          : snapshot.size_bytes === null
            ? null
            : formatBytes(snapshot.size_bytes),
      snapshot.note,
    ]
      .filter(Boolean)
      .join(' · ')
  const tabs = activeTabs(interrupted?.tabs ?? state.tabs)
  const runs = interrupted?.runs ?? []
  const agent = interrupted?.control?.holder === 'agent' ? interrupted.control : null
  return (
    <>
      <IconButton
        label={t('computer:snapshots.title')}
        disabled={blocked}
        onClick={() => {
          setProblem('')
          setOpen(true)
        }}
      >
        <History size={16} />
      </IconButton>
      <Sheet
        open={open && restoring === null}
        width={560}
        title={t('computer:snapshots.title')}
        onClose={() => !busy && setOpen(false)}
        actions={
          <>
            <Button disabled={busy} onClick={() => setOpen(false)}>
              {t('common:action.close')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={blocked || working}
              onClick={() => void create()}
            >
              {t('computer:snapshots.create')}
            </Button>
          </>
        }
      >
        <div className={settings.sheetStack}>
          <p>{t('computer:snapshots.description', { count: state.snapshot_keep ?? 0 })}</p>
          {problem && <Banner status="failed">{problem}</Banner>}
          <SettingsSection>
            {snapshots.length ? (
              snapshots.map((snapshot) => (
                <Row
                  key={snapshot.id}
                  group
                  title={date(snapshot.created_at)}
                  description={describe(snapshot)}
                >
                  {snapshot.state === 'ready' && (
                    <Button
                      disabled={busy || blocked || working}
                      onClick={() => {
                        setProblem('')
                        setInterrupted(null)
                        setRestoring(snapshot)
                      }}
                    >
                      {t('computer:snapshots.restore')}
                    </Button>
                  )}
                </Row>
              ))
            ) : (
              <Row title={t('computer:snapshots.empty')} />
            )}
          </SettingsSection>
          <label className={styles.note}>
            {t('computer:snapshots.note')}
            <TextField
              value={note}
              maxLength={500}
              placeholder={t('computer:snapshots.notePlaceholder')}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </div>
      </Sheet>
      <Sheet
        open={restoring !== null}
        title={t('computer:snapshots.confirmTitle', {
          time: restoring ? date(restoring.created_at) : '',
        })}
        onClose={() => !busy && setRestoring(null)}
        actions={
          <>
            <Button disabled={busy} onClick={() => setRestoring(null)}>
              {t('common:action.cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              disabled={blocked}
              onClick={() => void restore()}
            >
              {t(
                interrupted ? 'computer:snapshots.restoreAnyway' : 'computer:snapshots.restoreNow',
              )}
            </Button>
          </>
        }
      >
        <div className={settings.sheetStack}>
          <p>{t('computer:snapshots.confirmWhole')}</p>
          <p>{t('computer:snapshots.confirmKept')}</p>
          <p>{t('computer:snapshots.confirmSites')}</p>
          <p>{t('computer:snapshots.confirmFirst')}</p>
          {problem && <Banner status="failed">{problem}</Banner>}
          {(tabs.length > 0 || runs.length > 0 || agent) && (
            <SettingsSection title={t('computer:snapshots.interrupted')}>
              {tabs.map((tab) => (
                <Row
                  key={tab.target_id}
                  title={tab.title || t('computer:untitledTab')}
                  description={t('computer:snapshots.interruptedTab', {
                    work: tab.work_id ?? '',
                    state: tab.work_state ?? '',
                  })}
                />
              ))}
              {runs.map((item) => (
                <Row
                  key={item.run_id}
                  title={t('computer:snapshots.interruptedRun')}
                  description={item.run_id}
                />
              ))}
              {agent && (
                <Row
                  title={t('computer:snapshots.interruptedControl', { name })}
                  description={agent.work_id ?? undefined}
                />
              )}
            </SettingsSection>
          )}
        </div>
      </Sheet>
    </>
  )
}

/** The last restore while it runs or after it failed; a finished one needs no notice. */
export function RestoreNotice({ state }: { state: ComputerState }) {
  const { t } = useTranslation(['computer'])
  const { date } = useDisplayTime()
  const restore = state.last_restore
  if (!restore || restore.state === 'done') return null
  const time = date(
    state.snapshots?.find((snapshot) => snapshot.id === restore.snapshot_id)?.created_at ?? null,
  )
  return restore.state === 'accepted' ? (
    <Banner status="running">{t('computer:snapshots.restoring', { time })}</Banner>
  ) : (
    <Banner status="failed">
      {t('computer:snapshots.restoreFailed', { time })} {restore.error}
    </Banner>
  )
}
