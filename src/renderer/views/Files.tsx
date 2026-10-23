import { useEffect, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ArrowUpRight } from 'lucide-react'
import type { ArtifactSource, CachedContent } from '../../shared/api'
import { Banner, Button, EmptyState, Segmented } from '../components/Controls'
import { unwrap } from '../queries/client'
import { renderCode, useMarkdown } from '../text/markdown'
import styles from './Files.module.css'
import chatStyles from './Conversation.module.css'

const shortVersion = (version: string) => `${version.slice(0, 4)}…${version.slice(-4)}`
function useContent(id: string, item?: ArtifactSource) {
  return useQuery({
    queryKey: [id, 'artifact-content', item?.artifactId, item?.version],
    queryFn: () => window.yuki.client.artifactContent(id, item!).then(unwrap),
    enabled: !!item,
    retry: false,
  })
}
async function saveArtifact(id: string, source: ArtifactSource, query: QueryClient) {
  const saved = unwrap(await window.yuki.client.saveArtifact(id, source))
  if (saved)
    await query.invalidateQueries({
      queryKey: [id, 'artifact-content', source.artifactId, source.version],
    })
  return saved
}
export function ArtifactInspector({ id, source }: { id: string; source: ArtifactSource }) {
  const content = useContent(id, source),
    [problem, setProblem] = useState('')
  const data = content.error ? undefined : content.data
  const query = useQueryClient()
  useEffect(
    () =>
      window.yuki.client.onHint((character, kind) => {
        if (character === id && ['sync', 'artifacts', 'conversation', 'work'].includes(kind))
          void query.invalidateQueries({ queryKey: [id, 'artifact-content'] })
      }),
    [id, query],
  )
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
            <Button onClick={() => void act(saveArtifact(id, source, query))}>存到…</Button>
          </div>
          <Content
            key={data.sha256}
            content={data}
            open={() => void act(window.yuki.client.openArtifact(id, source).then(unwrap))}
          />
        </>
      )}
    </div>
  )
}
function useBlob(content: CachedContent) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!content.bytes) return
    const url = URL.createObjectURL(
      new Blob([Uint8Array.from(content.bytes).buffer], { type: content.mime }),
    )
    setUrl(url)
    return () => {
      setUrl(undefined)
      URL.revokeObjectURL(url)
    }
  }, [content])
  return url
}
function Content({ content, open }: { content: CachedContent; open?: () => void }) {
  const url = useBlob(content),
    [raw, setRaw] = useState(false)
  const [html, setHtml] = useState(''),
    [problem, setProblem] = useState('')
  const textual = !!content.bytes && /^(text\/|application\/json)/.test(content.mime)
  const text = textual ? new TextDecoder().decode(content.bytes!) : ''
  const markdown = useMarkdown(content.mime === 'text/markdown' && !raw ? text : '')
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
  if (content.mime.startsWith('image/') && url)
    return <img className={styles.image} src={url} alt={content.filename} />
  if (content.mime === 'application/pdf' && url)
    return <iframe className={styles.pdf} src={url} title={`PDF 預覽：${content.filename}`} />
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
        <div
          className={`${chatStyles.markdown} ${content.mime === 'text/markdown' && !raw ? '' : styles.lines}`}
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
          dangerouslySetInnerHTML={{
            __html: content.mime === 'text/markdown' && !raw ? markdown : html,
          }}
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
