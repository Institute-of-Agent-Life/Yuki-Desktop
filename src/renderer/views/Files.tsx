import { Fragment, useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FolderOpen, Copy, ArrowUpRight, X } from 'lucide-react'
import type { DiffRow } from '../../shared/diff'
import type { ArtifactPage, ArtifactSource, CachedContent, Home } from '../../shared/api'
import { Banner, Button, EmptyState, IconButton, Segmented } from '../components/Controls'
import { FileName, FileRow } from '../components/Content'
import { unwrap } from '../queries/client'
import { renderCode } from '../text/markdown'
import { Markdown } from '../text/RichMarkdown'
import { useWorkspace } from '../state/workspace'
import type { MessageReference } from '../../shared/message'
import { formatBytes } from '../../shared/media'
import styles from './Files.module.css'
import chatStyles from './Conversation.module.css'
import { useDisplayTime } from '../state/time'
import { useMediaContent } from './media-content'
import { MediaBody } from './Media'

type Reference = ArtifactPage['items'][number]
type Item = Reference & { references: Reference[] }
const source = (item: Reference): ArtifactSource => ({
  artifactId: item.artifact_id,
  version: item.version,
})
const shortVersion = (version: string) => `${version.slice(0, 4)}…${version.slice(-4)}`
async function saveArtifact(id: string, source: ArtifactSource) {
  return unwrap(await window.yuki.client.saveArtifact(id, source))
}

export function Files({
  id,
  initial,
  jump,
  work,
  onSelect,
}: {
  id: string
  initial?: ArtifactSource
  jump(ref: MessageReference): void
  work(workId: string): void
  onSelect(source: ArtifactSource): void
}) {
  const workspace = useWorkspace()
  const { date, group: dateGroup } = useDisplayTime()
  const query = useQueryClient(),
    [category, setCategory] = useState<'all' | 'image' | 'document' | 'code'>('all'),
    [selected, setSelected] = useState<ArtifactSource | undefined>(initial),
    [comparison, setComparison] = useState<ArtifactSource>(),
    [problem, setProblem] = useState('')
  useEffect(() => {
    if (initial) setSelected(initial)
  }, [initial?.artifactId, initial?.version])
  const page = useInfiniteQuery({
    queryKey: [id, 'artifacts', category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      window.yuki.client
        .read<ArtifactPage>(id, {
          kind: 'artifacts',
          category,
          ...(pageParam ? { cursor: pageParam } : {}),
        })
        .then(unwrap),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const home = useQuery({
    queryKey: [id, 'home'],
    queryFn: () => window.yuki.client.read<Home>(id, { kind: 'home' }).then(unwrap),
  })
  const items: Item[] = []
  for (const item of page.error ? [] : (page.data?.pages.flatMap((part) => part.items) ?? [])) {
    const existing = items.find((value) => value.artifact_id === item.artifact_id)
    if (existing) {
      if (
        !existing.references.some(
          (ref) =>
            ref.ref.event_id === item.ref.event_id && ref.ref.part_index === item.ref.part_index,
        )
      )
        existing.references.push(item)
    } else items.push({ ...item, references: [item] })
  }
  useEffect(() => {
    if (initial) {
      setSelected(initial)
      setComparison(undefined)
    }
  }, [initial])
  useEffect(() => {
    if (!selected && items[0]) {
      const first = source(items[0])
      setSelected(first)
      onSelect(first)
    }
  }, [selected, items, onSelect])
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['sync', 'artifacts', 'conversation', 'work'].includes(kind)) {
          void query.invalidateQueries({ queryKey: [id, 'artifacts'] })
        }
      }),
    [id, query],
  )
  const item = items.find(
    (item) => item.artifact_id === selected?.artifactId && item.version === selected?.version,
  )
  const content = useMediaContent(id, selected),
    other = useMediaContent(id, comparison)
  const data = content.error ? undefined : content.data
  const act = async (promise: Promise<unknown>) => {
    setProblem('')
    try {
      await promise
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '操作未完成。')
    }
  }
  const openReference = (ref: Reference) => {
    if (
      home.data?.main.conversation_id === ref.conversation_id ||
      home.data?.entries.some((entry) => entry.conversation_id === ref.conversation_id)
    )
      jump({ conversationId: ref.conversation_id, eventId: ref.ref.event_id })
    else if (ref.work_id) {
      work(ref.work_id)
      workspace.setView('works')
    } else setProblem('這個原入口的紀錄無法在桌面讀取。')
  }
  const label = (ref: Reference) =>
    home.data?.main.conversation_id === ref.conversation_id
      ? '桌面對話'
      : (home.data?.entries
          .find((entry) => entry.conversation_id === ref.conversation_id)
          ?.platform.toUpperCase() ?? (ref.work_id ? '原工作結果' : '原入口'))
  return (
    <div className={styles.files}>
      <section
        className={styles.list}
        onScroll={(event) => {
          const node = event.currentTarget
          if (
            node.scrollHeight - node.scrollTop - node.clientHeight < 160 &&
            page.hasNextPage &&
            !page.isFetchingNextPage
          )
            void page.fetchNextPage()
        }}
      >
        <header>
          <Segmented
            label="成果類型"
            value={category}
            onChange={setCategory}
            items={[
              { value: 'all', label: '全部' },
              { value: 'image', label: '圖片' },
              { value: 'document', label: '文件' },
              { value: 'code', label: '程式碼' },
            ]}
          />
        </header>
        {page.error && (
          <Banner status="failed">
            {page.error.message}
            <Button variant="plain" onClick={() => void page.refetch()}>
              重試
            </Button>
          </Banner>
        )}
        {items.map((item, index) => (
          <Fragment key={item.artifact_id}>
            {(!index || dateGroup(item.created_at) !== dateGroup(items[index - 1]!.created_at)) && (
              <h3 className={styles.date}>{dateGroup(item.created_at)}</h3>
            )}
            <div
              data-selected={selected?.artifactId === item.artifact_id}
              onDoubleClick={() => workspace.patch({ focusMode: true })}
            >
              <FileRow
                selected={selected?.artifactId === item.artifact_id}
                name={item.name}
                title={`${item.name}\n按兩下放大詳情`}
                identity={item.artifact_id}
                detail={`${date(item.created_at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · ${label(item)}`}
                size={item.size === null ? undefined : formatBytes(item.size)}
                onDragStart={(event) => {
                  event.preventDefault()
                  void act(window.yuki.client.dragArtifact(id, source(item)).then(unwrap))
                }}
                onOpen={() => {
                  setSelected(source(item))
                  onSelect(source(item))
                  setComparison(undefined)
                }}
              />
            </div>
          </Fragment>
        ))}
        {page.hasNextPage && (
          <Button
            variant="plain"
            loading={page.isFetchingNextPage}
            onClick={() => void page.fetchNextPage()}
          >
            載入更早成果
          </Button>
        )}
        {!page.isPending && !page.error && !items.length && (
          <EmptyState title="目前沒有成果">Yuki 傳給你的成果會出現在這裡。</EmptyState>
        )}
      </section>
      <section className={styles.stage} aria-label="成果預覽">
        {problem && <Banner status="failed">{problem}</Banner>}
        {content.error && (
          <Banner status="failed">
            {content.error.message}
            <Button variant="plain" onClick={() => void content.refetch()}>
              重新讀取
            </Button>
          </Banner>
        )}
        {!selected && <EmptyState title="選擇一項成果">預覽原版本與傳送記錄。</EmptyState>}
        {selected && content.isPending && <p role="status">正在讀取成果…</p>}
        {selected && data && (
          <>
            <header className={styles.previewHeader}>
              <h2 title={data.filename} aria-label={data.filename}>
                <FileName name={data.filename} compact={false} />
              </h2>
              <Button
                onClick={() => void act(saveArtifact(id, selected).then(() => content.refetch()))}
              >
                <Download size={15} />
                存到…
              </Button>
            </header>
            <div className={styles.stageBody}>
              <div className={styles.preview}>
                {comparison && (
                  <header className={styles.actions}>
                    <strong>並排比較原版本</strong>
                    <code>
                      {comparison.artifactId}@{shortVersion(comparison.version)}
                    </code>
                    <IconButton label="結束比較" onClick={() => setComparison(undefined)}>
                      <X size={15} />
                    </IconButton>
                  </header>
                )}
                {other.error && <Banner status="failed">{other.error.message}</Banner>}
                {comparison && !other.error && other.data ? (
                  <ArtifactComparison id={id} left={data} right={other.data} />
                ) : (
                  <Content
                    id={id}
                    key={data.sha256}
                    content={data}
                    open={() =>
                      void act(window.yuki.client.openArtifact(id, selected).then(unwrap))
                    }
                  />
                )}
              </div>
              <section className={styles.info} aria-label="成果資訊">
                <details>
                  <summary>詳細資料</summary>
                  <p>
                    <span>artifact ID</span> <code>{selected.artifactId}</code>
                  </p>
                  <p>
                    <span>內容版本</span>{' '}
                    <code title={selected.version}>{shortVersion(selected.version)}</code>
                  </p>
                  <p>
                    <span>發布路徑</span>{' '}
                    {item ? (item.published_path ?? '未提供') : '尚未讀取發布資訊'}
                  </p>
                </details>
                <div className={styles.actions}>
                  <Button
                    variant="plain"
                    disabled={!data.saved}
                    title={data.saved ? '在資料夾顯示' : '先將這個版本存到本機'}
                    onClick={() =>
                      void act(window.yuki.client.revealArtifact(id, selected).then(unwrap))
                    }
                  >
                    <FolderOpen size={15} />
                    在資料夾顯示
                  </Button>
                  <IconButton
                    label="複製成果連結文字"
                    onClick={() =>
                      void act(
                        window.yuki.client
                          .copy(`artifact:${selected.artifactId}@${selected.version}`)
                          .then(unwrap),
                      )
                    }
                  >
                    <Copy size={15} />
                  </IconButton>
                </div>
                {!!item?.references.length && (
                  <details>
                    <summary>傳送過的訊息</summary>
                    {item.references.map((ref) => (
                      <button
                        key={`${ref.ref.event_id}/${ref.ref.part_index}`}
                        className={styles.reference}
                        onClick={() => openReference(ref)}
                      >
                        {date(ref.created_at)} · {label(ref)}
                      </button>
                    ))}
                  </details>
                )}
                <details>
                  <summary>選擇另一項成果比較</summary>
                  <p>選擇可讀的原版本，依成果 ID 與內容版本比較。</p>
                  {items
                    .filter(
                      (other) =>
                        other.artifact_id !== selected.artifactId ||
                        other.version !== selected.version,
                    )
                    .map((other) => (
                      <div className={styles.version} key={`${other.artifact_id}/${other.version}`}>
                        <span>
                          {other.name} · {date(other.created_at)} · {other.artifact_id} ·{' '}
                          {shortVersion(other.version)}
                        </span>
                        <Button variant="plain" onClick={() => setComparison(source(other))}>
                          比較此版本
                        </Button>
                      </div>
                    ))}
                  {page.hasNextPage && (
                    <Button
                      variant="plain"
                      loading={page.isFetchingNextPage}
                      onClick={() => void page.fetchNextPage()}
                    >
                      載入更早成果
                    </Button>
                  )}
                </details>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

export function ArtifactInspector({
  id,
  source,
  library,
}: {
  id: string
  source: ArtifactSource
  library(): void
}) {
  const content = useMediaContent(id, source),
    [problem, setProblem] = useState('')
  const data = content.error ? undefined : content.data
  const act = async (promise: Promise<unknown>) => {
    try {
      setProblem('')
      await promise
    } catch (error) {
      setProblem(error instanceof Error ? error.message : '操作未完成。')
    }
  }
  return (
    <div className={styles.inspector}>
      {content.error && <Banner status="failed">{content.error.message}</Banner>}
      {problem && <Banner status="failed">{problem}</Banner>}
      {data && (
        <>
          <h2>{data.filename}</h2>
          <code>
            {source.artifactId} · {shortVersion(source.version)}
          </code>
          <div className={styles.actions}>
            <Button
              onClick={() => void act(saveArtifact(id, source).then(() => content.refetch()))}
            >
              存到…
            </Button>
            <Button variant="plain" onClick={library}>
              在檔案與成果查看
            </Button>
          </div>
          <Content
            id={id}
            key={data.sha256}
            content={data}
            open={() => void act(window.yuki.client.openArtifact(id, source).then(unwrap))}
          />
        </>
      )}
    </div>
  )
}
function Content({ id, content, open }: { id: string; content: CachedContent; open?: () => void }) {
  const [raw, setRaw] = useState(false)
  const [html, setHtml] = useState(''),
    [problem, setProblem] = useState('')
  const textual = !!content.bytes && /^(text\/|application\/json)/.test(content.mime)
  const text = textual ? new TextDecoder().decode(content.bytes!) : ''
  useEffect(() => {
    if (!textual) return
    let active = true
    void renderCode(text, language(content.filename))
      .then((html) => {
        if (active) setHtml(html)
      })
      .catch(() => {
        if (active) setProblem('語法色彩無法載入，可閱讀原始文字。')
      })
    return () => {
      active = false
    }
  }, [text, content.filename, textual])
  if (content.preview) return <MediaBody content={content} />
  if (textual)
    return (
      <>
        {problem && <Banner>{problem}</Banner>}
        <div className={styles.contentActions}>
          <Button
            variant="plain"
            onClick={() =>
              void window.yuki.client
                .copy(text)
                .then(unwrap)
                .catch((error) => setProblem(error.message))
            }
          >
            複製全文
          </Button>
          {content.mime === 'text/markdown' && (
            <Segmented
              label="Markdown 顯示"
              value={raw ? 'raw' : 'rendered'}
              onChange={(value) => setRaw(value === 'raw')}
              items={[
                { value: 'rendered', label: '預覽' },
                { value: 'raw', label: '原始碼' },
              ]}
            />
          )}
        </div>
        <Markdown
          id={id}
          text={content.mime === 'text/markdown' && !raw ? text : ''}
          className={`${chatStyles.markdown} ${content.mime === 'text/markdown' && !raw ? styles.document : styles.lines}`}
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]')
            if (link) {
              event.preventDefault()
              void window.yuki.client
                .external(link.href)
                .then(unwrap)
                .catch((error) => setProblem(error.message))
            }
            const copy = (event.target as HTMLElement).closest('button[data-code-copy]')
            const code = copy?.parentElement?.querySelector('pre code')?.textContent
            if (code !== undefined && code !== null)
              void window.yuki.client
                .copy(code)
                .then(unwrap)
                .catch((error) => setProblem(error.message))
          }}
          rendered={content.mime === 'text/markdown' && !raw ? undefined : html}
        />
        {!html && problem && <pre>{text}</pre>}
      </>
    )
  return (
    <EmptyState title="以其他程式開啟">
      {open && (
        <Button onClick={open}>
          <ArrowUpRight size={16} />
          以預設程式開啟
        </Button>
      )}
    </EmptyState>
  )
}
export function ArtifactComparison({
  id = '',
  left,
  right,
}: {
  id?: string
  left: CachedContent
  right: CachedContent
}) {
  const leftPane = useRef<HTMLElement>(null),
    rightPane = useRef<HTMLElement>(null)
  const [result, setResult] = useState<{ left: string; right: string; rows: DiffRow[] }>(),
    [error, setError] = useState('')
  const changes =
    result?.left === left.sha256 && result.right === right.sha256 ? result.rows : undefined
  const textual = (value: CachedContent) =>
    !!value.bytes && /^(text\/|application\/json)/.test(value.mime)
  useEffect(() => {
    if (!textual(left) || !textual(right)) return
    setError('')
    const worker = new Worker(new URL('../text/diff.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<DiffRow[]>) =>
      setResult({ left: left.sha256, right: right.sha256, rows: event.data })
    worker.onerror = () => setError('無法完成文字比較。')
    worker.postMessage({
      left: new TextDecoder().decode(left.bytes!),
      right: new TextDecoder().decode(right.bytes!),
    })
    return () => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
  }, [left, right])
  if (error) return <Banner status="failed">{error}</Banner>
  if (!textual(left) || !textual(right))
    return (
      <div className={styles.comparison}>
        <Content id={id} key={left.sha256} content={left} />
        <Content id={id} key={right.sha256} content={right} />
      </div>
    )
  if (!changes) return <p role="status">正在比較文字…</p>
  const pane = (side: 'left' | 'right') => (
    <section
      className={styles.diffPane}
      ref={side === 'left' ? leftPane : rightPane}
      aria-label={side === 'left' ? '目前成果原版本' : '比較的原版本'}
      onScroll={(event) => {
        const other = side === 'left' ? rightPane.current : leftPane.current
        if (other) other.scrollTop = event.currentTarget.scrollTop
      }}
    >
      <header>{side === 'left' ? left.filename : right.filename}</header>
      {changes.map((row, index) => (
        <div
          key={index}
          className={`${styles.diffLine} ${row.changed && row[side] !== null ? (side === 'left' ? styles.removed : styles.added) : ''}`}
        >
          <code>{row[side === 'left' ? 'leftNumber' : 'rightNumber'] ?? ''}</code>
          <pre>{row[side] ?? ' '}</pre>
        </div>
      ))}
    </section>
  )
  return (
    <div className={styles.diff} aria-label="文字版本差異">
      {pane('left')}
      {pane('right')}
    </div>
  )
}

const language = (filename: string) =>
  (
    ({
      js: 'javascript',
      ts: 'typescript',
      jsx: 'tsx',
      tsx: 'tsx',
      py: 'python',
      sh: 'shellscript',
      md: 'markdown',
    }) as Record<string, string>
  )[filename.split('.').at(-1)?.toLowerCase() ?? ''] ??
  filename.split('.').at(-1)?.toLowerCase() ??
  'text'
