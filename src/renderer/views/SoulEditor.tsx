import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { diffLines } from 'diff'
import { ArrowLeft, Info } from 'lucide-react'
import type { SoulCommand, SoulCommandItem, SoulDocument, SoulDraft } from '../../shared/api'
import { Banner, Button, EmptyState, Sheet } from '../components/Controls'
import { SoulCode } from '../components/SoulCode'
import { unwrap, ClientProblem, problemText } from '../queries/client'
import { guardNavigation, requestNavigation, type NavigationAttempt } from '../state/navigation'
import styles from './SoulEditor.module.css'
import { useSessionActive } from '../state/workspace'
import { useDisplayTime } from '../state/time'
import { useTranslation } from '../i18n'

const short = (revision: string) =>
  revision.replace(/^sha256:/, '').replace(/^(.{6}).*(.{4})$/, '$1…$2')
const dirty = (draft: SoulDraft) => draft.draft !== draft.baseContent
const conflict = (draft: SoulDraft) => dirty(draft) && draft.remote.revision !== draft.baseRevision

export function SoulEditor({
  id,
  back,
  toolbar,
  name,
  platform,
}: {
  id: string
  back(): void
  toolbar?: HTMLElement | null
  name: string
  platform: string
}) {
  const { timeLabel, locale } = useDisplayTime()
  const { t } = useTranslation(['soul', 'common'])
  const active = useSessionActive()
  const hintId = useId()
  const [hintDismissed, setHintDismissed] = useState(false)
  const [drafts, setDrafts] = useState<SoulDraft[]>([])
  const current = useRef(drafts)
  const versions = useRef(0)
  const [documents, setDocuments] = useState<SoulDocument>()
  const [commands, setCommands] = useState<SoulCommandItem[]>([])
  const [error, setError] = useState('')
  const [denied, setDenied] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [restore, setRestore] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [overwrite, setOverwrite] = useState<SoulDraft>()
  const [undoable, setUndoable] = useState(0)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const [notice, setNotice] = useState('')
  const [savedAt, setSavedAt] = useState<string>()
  const [savedRecent, setSavedRecent] = useState(false)
  const [leaving, setLeaving] = useState<NavigationAttempt>()
  const leavingRef = useRef<NavigationAttempt>(undefined)
  const alive = useRef(true)
  const writes = useRef<Promise<boolean>>(Promise.resolve(true))
  const writeError = useRef(false)
  const loadSequence = useRef(0)
  const change = useCallback((next: SoulDraft[]) => {
    current.current = next
    if (alive.current) setDrafts(next)
  }, [])
  const persist = useCallback(
    (draft: SoulDraft) => {
      versions.current++
      writes.current = writes.current.then(async () => {
        try {
          unwrap(await window.yuki.client.soulEdit(id, draft))
          writeError.current = false
          return true
        } catch (error) {
          writeError.current = true
          if (alive.current)
            setError(
              t('soul:draftSaveFailed', {
                reason: error instanceof Error ? error.message : t('soul:retry'),
              }),
            )
          return false
        }
      })
      return writes.current
    },
    [id, t],
  )
  const load = useCallback(
    async (initial = false) => {
      const sequence = ++loadSequence.current
      const captured = versions.current
      try {
        const response = unwrap(await window.yuki.client.soulDocument(id))
        if (!alive.current || sequence !== loadSequence.current) return
        setDenied(false)
        setDocuments(response.document)
        const next = (response.draft ? [response.draft] : []).map((incoming) => {
          const local = current.current[0]
          // A response started before the first keystroke may update remote facts only.
          return local && versions.current !== captured
            ? { ...local, remote: incoming.remote }
            : incoming
        })
        if (
          !initial &&
          next.some((item) => {
            const previous = current.current[0]
            return previous && !dirty(previous) && previous.baseRevision !== item.baseRevision
          })
        )
          setNotice(t('soul:updated'))
        change(next)
      } catch (error) {
        if (!alive.current || sequence !== loadSequence.current) return
        if (
          error instanceof ClientProblem &&
          [
            'unauthenticated',
            'forbidden',
            'not_found',
            'outbox_owner_mismatch',
            'different_character',
          ].includes(error.code)
        )
          setDenied(true)
        setError(error instanceof Error ? error.message : t('soul:readFailed'))
      }
      const items = await window.yuki.client.soulCommands(id)
      if (alive.current && sequence === loadSequence.current && items.ok) setCommands(items.value)
    },
    [id, change, t],
  )
  useEffect(() => {
    alive.current = true
    void (async () => {
      const [local, receipts] = await Promise.all([
        window.yuki.client.soulDraft(id),
        window.yuki.client.soulCommands(id),
      ])
      if (!alive.current) return
      if (receipts.ok) setCommands(receipts.value)
      if (local.ok) {
        setRestore(!!local.value && dirty(local.value))
        change(local.value ? [local.value] : [])
      }
      await load(true)
    })()
    const remove = window.yuki.client.onHint((character, kind) => {
      if (character === id && ['character', 'sync', 'soul-command'].includes(kind)) void load()
    })
    return () => {
      alive.current = false
      remove()
      leavingRef.current?.cancel()
    }
  }, [id, load, change])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 4000)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!savedAt) return
    setSavedRecent(true)
    const timer = setTimeout(() => setSavedRecent(false), 3000)
    return () => clearTimeout(timer)
  }, [savedAt])
  useEffect(
    () =>
      active
        ? guardNavigation((attempt) => {
            if (denied) return false
            if (busyRef.current) {
              attempt.cancel()
              return true
            }
            const draft = current.current.find(dirty)
            if (!draft || !dirty(draft)) return false
            if (leavingRef.current) {
              attempt.cancel()
              return true
            }
            leavingRef.current = attempt
            setLeaving(attempt)
            return true
          })
        : undefined,
    [denied, active],
  )
  useEffect(() => {
    if (!denied) return
    leavingRef.current?.cancel()
    leavingRef.current = undefined
    setLeaving(undefined)
  }, [denied])
  const cancelLeave = () => {
    leavingRef.current?.cancel()
    leavingRef.current = undefined
    setLeaving(undefined)
  }
  const finishLeave = () => {
    const remaining = current.current.find(dirty)
    if (remaining) {
      return
    }
    const attempt = leavingRef.current
    leavingRef.current = undefined
    setLeaving(undefined)
    attempt?.proceed()
  }
  const run = async (command: SoulCommand, requestId?: string) => {
    if (busyRef.current) return false
    busyRef.current = true
    loadSequence.current++
    setBusy(true)
    setError('')
    try {
      await writes.current
      if (writeError.current) return false
      const item = unwrap(
        await (requestId
          ? window.yuki.client.verifySoulCommand(id, requestId)
          : window.yuki.client.soulCommand(id, command)),
      )
      if (!alive.current) return false
      const next = unwrap(await window.yuki.client.soulDraft(id))
      change(next ? [next] : [])
      setCommands(unwrap(await window.yuki.client.soulCommands(id)))
      if (item.state !== 'result') {
        setError(t('soul:unconfirmed'))
        return false
      }
      if (item.problem) {
        setError(
          item.details?.written === true
            ? t('soul:writtenNotApplied')
            : item.problem === 'version_conflict'
              ? t('soul:versionConflict')
              : item.problem === 'precondition_failed'
                ? t('soul:writeAccess')
                : problemText(item.problem),
        )
        await load()
        return false
      }
      setSavedAt(item.result?.applied_at)
      await load()
      return true
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : t('soul:saveFailed'))
      return false
    } finally {
      busyRef.current = false
      if (alive.current) setBusy(false)
    }
  }
  const save = (draft = current.current[0]) => {
    if (!draft || restore || denied) return Promise.resolve(false)
    return run({
      kind: 'save',
      expectedRevision: draft.baseRevision,
      content: draft.draft,
    })
  }
  const discard = async (draft: SoulDraft, undo = true) => {
    if (undo) setUndoable((value) => value + 1)
    const next = {
      ...draft,
      baseRevision: draft.remote.revision,
      baseContent: draft.remote.content,
      draft: draft.remote.content,
    }
    if (await persist(next)) {
      change([next])
      setError('')
      setComparing(false)
    }
  }
  const draft = drafts[0]
  const pending = commands.filter((item) => item.state !== 'result')
  const readOnly = busy || restore || denied
  const changed = !!draft && dirty(draft)
  const saveFromKeyboard = useRef<() => void>(() => {})
  saveFromKeyboard.current = () => {
    const currentDraft = current.current[0]
    if (!readOnly && currentDraft && dirty(currentDraft)) void save(currentDraft)
  }
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = platform === 'darwin' ? event.metaKey : event.ctrlKey
      if (
        event.defaultPrevented ||
        !modifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== 's' ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      )
        return
      event.preventDefault()
      saveFromKeyboard.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, platform])
  const conflicted = !!draft && conflict(draft)
  const applied = !!documents && documents.active_revision !== documents.revision
  const returnToAbout = () => requestNavigation(back)
  const effectExplanation = t('soul:effect', { placeholder: '{{name}}', name })
  const cacheExplanation = !commands.some((item) => item.command.kind === 'save')
    ? t('soul:cache')
    : ''
  const header = (
    <div className={styles.toolbar}>
      <Button
        variant="plain"
        className={styles.back}
        title={t('soul:aboutName', { name })}
        onClick={returnToAbout}
      >
        <ArrowLeft size={14} />
        <span>{t('soul:aboutName', { name })}</span>
      </Button>
      <strong>SOUL.md</strong>
      <span
        className={changed ? styles.unsaved : savedRecent ? styles.saved : styles.status}
        role="status"
      >
        {changed
          ? t('soul:unsaved')
          : savedAt
            ? t('soul:savedAt', { time: timeLabel(savedAt) })
            : ''}
      </span>
      <div
        className={styles.compactHint}
        data-dismissed={hintDismissed}
        onMouseEnter={() => setHintDismissed(false)}
      >
        <Button
          variant="plain"
          className={styles.infoButton}
          aria-label={t('soul:effectInfo')}
          aria-describedby={hintId}
          onFocus={() => setHintDismissed(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setHintDismissed(true)
            }
          }}
        >
          <Info size={16} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <span id={hintId} role="tooltip" className={styles.hintText}>
          {effectExplanation} {cacheExplanation}
        </span>
      </div>
      <Button
        disabled={!changed || readOnly}
        onClick={() => {
          if (!draft) return
          setUndoable((value) => value + 1)
          const next = { ...draft, draft: draft.baseContent }
          change([next])
          void persist(next)
        }}
      >
        {t('soul:revert')}
      </Button>
      <Button
        variant="primary"
        disabled={!changed || readOnly}
        loading={busy}
        onClick={() => void save()}
      >
        {t('common:action.save')}
        <kbd aria-hidden="true">{platform === 'darwin' ? '⌘S' : 'Ctrl S'}</kbd>
      </Button>
    </div>
  )
  if (denied) return <Banner status="failed">{error}</Banner>
  if (!draft)
    return (
      <EmptyState
        title="SOUL.md"
        action={<Button onClick={() => void load(true)}>{t('common:action.reload')}</Button>}
      >
        {error || t('common:reading')}
      </EmptyState>
    )
  return (
    <section className={styles.editor} aria-label={t('soul:editor')}>
      {toolbar ? createPortal(header, toolbar) : header}
      <div className={styles.explanation}>
        <p>{effectExplanation}</p>
        {cacheExplanation && <p>{cacheExplanation}</p>}
      </div>
      {error && !restore && !leaving && <Banner status="failed">{error}</Banner>}
      {!draft.remote.writable && <Banner>{t('soul:writeAccess')}</Banner>}
      {applied && (
        <Banner>
          {t('soul:fileDiffers')}
          <Button variant="plain" loading={busy} onClick={() => void run({ kind: 'reload' })}>
            {t('soul:reloadSoul')}
          </Button>
        </Banner>
      )}
      {pending.map((item) => (
        <Banner key={item.requestId}>
          {t('soul:pending')}
          <Button
            variant="plain"
            loading={busy}
            onClick={() => void run(item.command, item.requestId)}
          >
            {t('soul:verify')}
          </Button>
        </Banner>
      ))}
      {conflicted && (
        <div className={styles.conflict} role="status">
          <span
            title={
              draft.remote.updated_at
                ? t('soul:conflictAt', { time: timeLabel(draft.remote.updated_at) })
                : t('soul:conflict')
            }
          >
            {t('soul:conflict')}
          </span>
          <Button variant="plain" onClick={() => setComparing(true)}>
            {t('soul:compare')}
          </Button>
          <Button variant="plain" disabled={readOnly} onClick={() => setOverwrite(draft)}>
            {t('soul:overwriteMine')}
          </Button>
          <Button variant="plain" disabled={readOnly} onClick={() => void discard(draft)}>
            {t('soul:discardMine')}
          </Button>
        </div>
      )}
      {notice && (
        <div className={styles.notice} role="status">
          {notice}
        </div>
      )}
      {comparing && conflicted ? (
        <div className={styles.comparison}>
          <div className={styles.diff}>
            {(['remote', 'draft'] as const).map((side) => (
              <section
                key={side}
                aria-label={side === 'remote' ? t('soul:remoteVersion') : t('soul:draftPreview')}
              >
                <h3>{side === 'remote' ? t('soul:remoteVersion') : t('soul:draftPreview')}</h3>
                <pre>
                  {diffLines(draft.remote.content, draft.draft)
                    .filter((part) => (side === 'remote' ? !part.added : !part.removed))
                    .map((part, index) => (
                      <span
                        key={index}
                        className={part.added || part.removed ? styles.changed : undefined}
                      >
                        {part.value}
                      </span>
                    ))}
                </pre>
              </section>
            ))}
          </div>
          <footer>
            <Button
              variant="primary"
              disabled={readOnly}
              onClick={async () => {
                const next = {
                  ...draft,
                  baseRevision: draft.remote.revision,
                  baseContent: draft.remote.content,
                }
                if (await persist(next)) {
                  change([next])
                  setComparing(false)
                  setError('')
                }
              }}
            >
              {t('soul:rebase')}
            </Button>
            <Button onClick={() => setComparing(false)}>{t('common:action.close')}</Button>
          </footer>
        </div>
      ) : (
        <div className={styles.code} aria-label="SOUL.md">
          <SoulCode
            label={t('soul:content')}
            content={draft.draft}
            readOnly={readOnly}
            undoableChange={undoable}
            onChange={(content) => {
              const next = { ...current.current[0]!, draft: content }
              change([next])
              void persist(next)
            }}
            onSave={() => saveFromKeyboard.current()}
            onBack={returnToAbout}
            onCursor={(line, column) => setCursor({ line, column })}
          />
        </div>
      )}
      <footer className={styles.footer}>
        <span>
          {t('soul:position', cursor)} ·{' '}
          {t('soul:characters', {
            count: Array.from(draft.draft).length,
            characters: Array.from(draft.draft).length.toLocaleString(locale),
          })}
        </span>
        <span title={draft.remote.file_name}>
          {t('soul:fileInfo', {
            name: draft.remote.file_name,
            revision: short(draft.baseRevision),
          })}
        </span>
        {conflicted && (
          <span>
            {t('soul:conflictInfo', {
              draft: short(draft.baseRevision),
              server: short(draft.remote.revision),
            })}
          </span>
        )}
      </footer>
      <Sheet
        title={t('soul:saveChanges')}
        open={!!leaving}
        onClose={cancelLeave}
        actions={
          <>
            <Button onClick={cancelLeave}>{t('common:action.cancel')}</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await discard(draft, false)
                if (!writeError.current) finishLeave()
              }}
            >
              {t('soul:dontSave')}
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={readOnly}
              onClick={async () => {
                if (await save()) finishLeave()
              }}
            >
              {t('common:action.save')}
            </Button>
          </>
        }
      >
        <p>{t('soul:unsavedFile', { name: draft.remote.file_name })}</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title={t('soul:overwriteTitle')}
        open={!!overwrite}
        onClose={() => setOverwrite(undefined)}
        actions={
          <>
            <Button onClick={() => setOverwrite(undefined)}>{t('common:action.cancel')}</Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                if (!overwrite) return
                const rebased = {
                  ...overwrite,
                  baseRevision: overwrite.remote.revision,
                  baseContent: overwrite.remote.content,
                }
                setOverwrite(undefined)
                if (await persist(rebased)) {
                  change([rebased])
                  await save(rebased)
                }
              }}
            >
              {t('soul:overwrite')}
            </Button>
          </>
        }
      >
        <p>{t('soul:overwriteNote')}</p>
      </Sheet>
      <Sheet
        title={t('soul:restoreTitle')}
        open={restore}
        onClose={() => {
          setRestore(false)
          back()
        }}
        actions={
          <>
            <Button
              onClick={async () => {
                for (const item of current.current.filter(dirty)) await discard(item, false)
                if (!writeError.current) setRestore(false)
              }}
            >
              {t('soul:dontRestore')}
            </Button>
            <Button variant="primary" onClick={() => setRestore(false)}>
              {t('soul:restoreDraft')}
            </Button>
          </>
        }
      >
        <p>{t('soul:restoreNote')}</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
    </section>
  )
}
