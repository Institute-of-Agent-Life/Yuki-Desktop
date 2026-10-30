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

const short = (revision: string) =>
  revision.replace(/^sha256:/, '').replace(/^(.{6}).*(.{4})$/, '$1…$2')
const dirty = (draft: SoulDraft) => draft.draft !== draft.baseContent
const conflict = (draft: SoulDraft) => dirty(draft) && draft.remote.revision !== draft.baseRevision
const reason = () => '請確認 SOUL.md 原件及其目錄的實際寫入權限。'

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
  const { timeLabel } = useDisplayTime()
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
            setError(`本機草稿未能儲存：${error instanceof Error ? error.message : '請重試。'}`)
          return false
        }
      })
      return writes.current
    },
    [id],
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
          setNotice('已更新為最新版本')
        change(next)
      } catch (error) {
        if (!alive.current || sequence !== loadSequence.current) return
        if (
          error instanceof ClientProblem &&
          ['unauthenticated', 'not_found', 'outbox_owner_mismatch', 'different_character'].includes(
            error.code,
          )
        )
          setDenied(true)
        setError(error instanceof Error ? error.message : '無法讀取 SOUL.md。')
      }
      const items = await window.yuki.client.soulCommands(id)
      if (alive.current && sequence === loadSequence.current && items.ok) setCommands(items.value)
    },
    [id, change],
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
        setError('儲存結果尚未確認。內容與原請求已保留在這台電腦；請查證原請求。')
        return false
      }
      if (item.problem) {
        setError(
          item.details?.written === true
            ? '已寫入但未生效，請按重新載入。'
            : item.problem === 'version_conflict'
              ? '儲存未完成：伺服器版本已改變，請先處理差異'
              : item.problem === 'precondition_failed'
                ? reason()
                : problemText(item.problem),
        )
        await load()
        return false
      }
      setSavedAt(item.result?.applied_at)
      await load()
      return true
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : '儲存未完成。')
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
  const effectExplanation = `SOUL 決定性格與表達，{{name}} 會換成目前的名稱。儲存後，${name}下一次開始新的回覆或恢復工作時採用新版；正在進行的那一段用原本的內容做完。記憶與歷史不變。`
  const cacheExplanation = !commands.some((item) => item.command.kind === 'save')
    ? '修改可能影響模型的前綴快取，實際情況以上游 Provider 回報的 usage 為準。'
    : ''
  const header = (
    <div className={styles.toolbar}>
      <Button
        variant="plain"
        className={styles.back}
        title={`關於 ${name}`}
        onClick={returnToAbout}
      >
        <ArrowLeft size={14} />
        <span>關於 {name}</span>
      </Button>
      <strong>SOUL.md</strong>
      <span
        className={changed ? styles.unsaved : savedRecent ? styles.saved : styles.status}
        role="status"
      >
        {changed ? '● 未儲存' : savedAt ? `已儲存 ${timeLabel(savedAt)}` : ''}
      </span>
      <div
        className={styles.compactHint}
        data-dismissed={hintDismissed}
        onMouseEnter={() => setHintDismissed(false)}
      >
        <Button
          variant="plain"
          className={styles.infoButton}
          aria-label="SOUL 生效說明"
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
        還原
      </Button>
      <Button
        variant="primary"
        disabled={!changed || readOnly}
        loading={busy}
        onClick={() => void save()}
      >
        儲存
        <kbd aria-hidden="true">{platform === 'darwin' ? '⌘S' : 'Ctrl S'}</kbd>
      </Button>
    </div>
  )
  if (denied) return <Banner status="failed">{error}</Banner>
  if (!draft)
    return (
      <EmptyState
        title="SOUL.md"
        action={<Button onClick={() => void load(true)}>重新讀取</Button>}
      >
        {error || '正在讀取…'}
      </EmptyState>
    )
  return (
    <section className={styles.editor} aria-label="SOUL 編輯器">
      {toolbar ? createPortal(header, toolbar) : header}
      <div className={styles.explanation}>
        <p>{effectExplanation}</p>
        {cacheExplanation && <p>{cacheExplanation}</p>}
      </div>
      {error && !restore && !leaving && <Banner status="failed">{error}</Banner>}
      {!draft.remote.writable && <Banner>{reason()}</Banner>}
      {applied && (
        <Banner>
          檔案版本與目前生效版本不同。
          <Button variant="plain" loading={busy} onClick={() => void run({ kind: 'reload' })}>
            重新載入
          </Button>
        </Banner>
      )}
      {pending.map((item) => (
        <Banner key={item.requestId}>
          原請求結果尚未確認。
          <Button
            variant="plain"
            loading={busy}
            onClick={() => void run(item.command, item.requestId)}
          >
            查證原請求
          </Button>
        </Banner>
      ))}
      {conflicted && (
        <div className={styles.conflict} role="status">
          <span
            title={`另一台裝置在 ${draft.remote.updated_at ? timeLabel(draft.remote.updated_at) : '稍早'} 儲存了新版本。你的草稿基於較早的版本。`}
          >
            另一台裝置儲存了新版本。你的草稿基於較早的版本。
          </span>
          <Button variant="plain" onClick={() => setComparing(true)}>
            比較差異
          </Button>
          <Button variant="plain" disabled={readOnly} onClick={() => setOverwrite(draft)}>
            以我的版本覆蓋…
          </Button>
          <Button variant="plain" disabled={readOnly} onClick={() => void discard(draft)}>
            放棄我的修改
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
                aria-label={side === 'remote' ? '伺服器目前版本（唯讀）' : '你的草稿（唯讀預覽）'}
              >
                <h3>{side === 'remote' ? '伺服器目前版本（唯讀）' : '你的草稿（唯讀預覽）'}</h3>
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
              在新版上重新編輯
            </Button>
            <Button onClick={() => setComparing(false)}>關閉</Button>
          </footer>
        </div>
      ) : (
        <div className={styles.code} aria-label="SOUL.md">
          <SoulCode
            label="SOUL.md 內容"
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
          第 {cursor.line} 行，第 {cursor.column} 欄 ·{' '}
          {Array.from(draft.draft).length.toLocaleString()} 字
        </span>
        <span title={draft.remote.file_name}>
          檔案 {draft.remote.file_name} · 版本 {short(draft.baseRevision)}
        </span>
        {conflicted && (
          <span>
            草稿基於 {short(draft.baseRevision)} · 伺服器目前 {short(draft.remote.revision)}
          </span>
        )}
      </footer>
      <Sheet
        title="要儲存變更嗎？"
        open={!!leaving}
        onClose={cancelLeave}
        actions={
          <>
            <Button onClick={cancelLeave}>取消</Button>
            <Button
              disabled={busy}
              onClick={async () => {
                await discard(draft, false)
                if (!writeError.current) finishLeave()
              }}
            >
              不儲存
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={readOnly}
              onClick={async () => {
                if (await save()) finishLeave()
              }}
            >
              儲存
            </Button>
          </>
        }
      >
        <p>{draft.remote.file_name} 的修改尚未儲存。</p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
      <Sheet
        title="以我的版本覆蓋？"
        open={!!overwrite}
        onClose={() => setOverwrite(undefined)}
        actions={
          <>
            <Button onClick={() => setOverwrite(undefined)}>取消</Button>
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
              覆蓋
            </Button>
          </>
        }
      >
        <p>這會用你的草稿取代另一台裝置剛儲存的版本。</p>
      </Sheet>
      <Sheet
        title="恢復未儲存的草稿？"
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
              不恢復
            </Button>
            <Button variant="primary" onClick={() => setRestore(false)}>
              恢復草稿
            </Button>
          </>
        }
      >
        <p>
          這台電腦保留了{' '}
          {drafts
            .filter(dirty)
            .map(() => `SOUL.md`)
            .join('、')}{' '}
          的修改。草稿仍以當時的版本為基線。
        </p>
        {error && <Banner status="failed">{error}</Banner>}
      </Sheet>
    </section>
  )
}
