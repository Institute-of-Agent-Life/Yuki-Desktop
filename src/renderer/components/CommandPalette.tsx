import { useEffect, useId, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { File, MessageCircle, BriefcaseBusiness, Command } from 'lucide-react'
import { loadedItems, type LoadedItem } from '../state/loaded'
import styles from './CommandPalette.module.css'

export interface PaletteCommand {
  id: string
  title: string
  detail?: string
  run(stage: boolean): Promise<void> | void
}
type Item = LoadedItem | ({ kind: 'command'; at: number; detail: string } & PaletteCommand)
const labels = { message: '對話訊息', work: '工作', file: '檔案', command: '指令' }
const icons = { message: MessageCircle, work: BriefcaseBusiness, file: File, command: Command }
export function CommandPalette({
  character,
  commands,
  pick,
  close,
}: {
  character: string
  commands: PaletteCommand[]
  pick(item: LoadedItem, stage: boolean): Promise<void>
  close(): void
}) {
  const query = useQueryClient(),
    [cached, setCached] = useState(() => loadedItems(query, character))
  const [text, setText] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const items: Item[] = [
    ...cached,
    ...commands.map((command) => ({
      ...command,
      kind: 'command' as const,
      detail: command.detail ?? '',
      at: 0,
    })),
  ]
  const filter = (value: string) =>
    items.filter((item) =>
      `${item.title}\n${item.detail}`
        .toLocaleLowerCase()
        .includes(value.trim().toLocaleLowerCase()),
    )
  const visible = filter(text),
    grouped = (Object.keys(labels) as Item['kind'][]).flatMap((kind) =>
      visible.filter((item) => item.kind === kind),
    )
  const [selected, setSelected] = useState<string | null>(() => grouped[0]?.id ?? null)
  const active = grouped.findIndex((item) => item.id === selected),
    ref = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null),
    prefix = useId(),
    live = useRef(true)
  useEffect(
    () =>
      query.getQueryCache().subscribe((event) => {
        if (
          ['updated', 'removed', 'added'].includes(event.type) &&
          event.query.queryKey[0] === character
        )
          setCached(loadedItems(query, character))
      }),
    [query, character],
  )
  useEffect(() => {
    live.current = true
    const previous = document.activeElement
    ref.current!.showModal()
    input.current?.focus()
    return () => {
      live.current = false
      ref.current?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (active >= 0)
      document.getElementById(`${prefix}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, prefix])
  const execute = async (item: Item | undefined, stage: boolean) => {
    if (busy) return
    if (!item) {
      setError('所選項目已更新，請重新選擇。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (item.kind === 'command') await item.run(stage)
      else await pick(item, stage)
    } catch (error) {
      if (live.current) setError(error instanceof Error ? error.message : '無法開啟這個項目。')
    } finally {
      if (live.current) setBusy(false)
    }
  }
  return (
    <dialog
      ref={ref}
      className={styles.palette}
      aria-label="指令面板"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect()
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close()
        }
      }}
    >
      <div className={styles.body}>
        <input
          ref={input}
          className={styles.input}
          role="combobox"
          aria-label="搜尋已載入的對話、工作與檔案"
          placeholder="搜尋已載入的對話、工作與檔案"
          aria-expanded="true"
          aria-controls={`${prefix}-results`}
          aria-activedescendant={active >= 0 ? `${prefix}-${active}` : undefined}
          value={text}
          readOnly={busy}
          onChange={(event) => {
            const value = event.target.value
            setText(value)
            setError('')
            const result = filter(value)
            const first = (Object.keys(labels) as Item['kind'][]).flatMap((kind) =>
              result.filter((item) => item.kind === kind),
            )[0]
            setSelected(first?.id ?? null)
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (busy) return
            if (event.key === 'Enter') {
              event.preventDefault()
              void execute(grouped[active], event.metaKey || event.ctrlKey)
            } else if (['ArrowUp', 'ArrowDown'].includes(event.key) && grouped.length) {
              event.preventDefault()
              const next =
                active < 0
                  ? event.key === 'ArrowDown'
                    ? 0
                    : grouped.length - 1
                  : (active + (event.key === 'ArrowDown' ? 1 : grouped.length - 1)) % grouped.length
              setSelected(grouped[next]!.id)
              setError('')
            }
          }}
        />
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <div
          className={styles.results}
          id={`${prefix}-results`}
          role="listbox"
          aria-label="搜尋結果"
          aria-busy={busy}
        >
          {!grouped.length && <p className={styles.empty}>已載入的內容中沒有符合的項目。</p>}
          {(Object.keys(labels) as Item['kind'][]).map((kind) => {
            const rows = grouped.filter((item) => item.kind === kind)
            const Icon = icons[kind]
            return (
              rows.length > 0 && (
                <div role="group" aria-labelledby={`${prefix}-group-${kind}`} key={kind}>
                  <h3 className={styles.group} id={`${prefix}-group-${kind}`}>
                    {labels[kind]}
                  </h3>
                  {rows.map((item) => {
                    const index = grouped.indexOf(item)
                    return (
                      <button
                        key={item.id}
                        data-item-id={item.id}
                        id={`${prefix}-${index}`}
                        className={styles.item}
                        role="option"
                        aria-selected={item.id === selected}
                        tabIndex={-1}
                        disabled={busy}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={() => setSelected(item.id)}
                        onClick={(event) => void execute(item, event.metaKey || event.ctrlKey)}
                      >
                        <Icon size={14} strokeWidth={1.5} />
                        <span className={styles.label}>
                          <span className={styles.title}>{item.title}</span>
                          {item.detail && <span className={styles.detail}>{item.detail}</span>}
                        </span>
                        {item.id === selected && <kbd aria-hidden="true">↩</kbd>}
                      </button>
                    )
                  })}
                </div>
              )
            )
          })}
        </div>
        <p className={styles.foot}>只搜尋這台電腦已載入的內容</p>
      </div>
    </dialog>
  )
}
