import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArtifactComparison } from '../../src/renderer/views/Files'
import type { CachedContent } from '../../src/shared/api'
import '../../src/renderer/tokens.css'

async function content(text: string): Promise<CachedContent> {
  const bytes = new TextEncoder().encode(text)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return {
    bytes,
    sha256: [...hash].map((value) => value.toString(16).padStart(2, '0')).join(''),
    mime: 'text/plain',
    filename: 'comparison.txt',
  }
}
function Compare() {
  const [left, setLeft] = useState('same\nold\nend\n'),
    [right, setRight] = useState('same\nnew\nextra\nend\n')
  const [pair, setPair] = useState<{ left: CachedContent; right: CachedContent }>()
  return (
    <main
      style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, height: '100vh' }}
    >
      <h1>成果比較元件驗證</h1>
      <label>
        原版本
        <textarea
          aria-label="原版本"
          value={left}
          onChange={(event) => setLeft(event.target.value)}
        />
      </label>
      <label>
        比較版本
        <textarea
          aria-label="比較版本"
          value={right}
          onChange={(event) => setRight(event.target.value)}
        />
      </label>
      <button
        onClick={() =>
          void Promise.all([content(left), content(right)]).then(([left, right]) =>
            setPair({ left, right }),
          )
        }
      >
        比較原文字
      </button>
      {pair && <ArtifactComparison left={pair.left} right={pair.right} />}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Compare />)
