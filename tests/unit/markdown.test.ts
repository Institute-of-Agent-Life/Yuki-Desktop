import { expect, it } from 'vitest'
import { internalImage, renderMarkdown } from '../../src/renderer/text/markdown'

it('highlights real fenced code for four themes while preserving escaped code and the copy affordance', async () => {
  const html = await renderMarkdown('```javascript\nconst text = "<script>"\n```')
  expect(html).toContain('--shiki-light:')
  expect(html).toContain('--shiki-contrast-dark:')
  expect(html).toContain('data-code-copy')
  expect(html).toMatch(/&(?:lt;|#x0*3c;|#0*60;)script(?:>|&gt;|&#x0*3e;|&#0*62;)/i)
  expect(html).not.toContain('<script>')
})
it('renders local mathematics, leaves code literal and resolves only explicit immutable/internal image sources', async () => {
  const source = 'artifact:00000000-0000-5000-8000-000000000001@' + 'a'.repeat(64)
  const html = await renderMarkdown(
    `An equation $x^2 + 1$.\n\n\`$literal$\`\n\n![diagram](${source})\n\n\`\`\`mermaid\ngraph LR\nA-->B\n\`\`\``,
  )
  expect(html).toContain('class="katex"')
  expect(html).toContain('<code>$literal$</code>')
  expect(html).toContain('data-media-ref="' + source + '"')
  expect(html).toContain('data-mermaid')
  expect(internalImage(source)).toEqual({
    artifactId: '00000000-0000-5000-8000-000000000001',
    version: 'a'.repeat(64),
  })
  expect(internalImage('https://example.invalid/image.png')).toBeUndefined()
  expect(internalImage('file:///C:/private.png')).toBeUndefined()
})
it('keeps unknown code languages readable and blocks raw HTML, external image loads and script links', async () => {
  const html = await renderMarkdown(
    '```unknown\n<svg onload="bad()">\n```\n<script>bad()</script>\n![image](https://example.invalid/x)\n[run](javascript:bad())',
  )
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<svg ')
  expect(html).not.toContain('<img ')
  expect(html).not.toContain('href="javascript:')
  expect(html).toMatch(/&(?:lt;|#x0*3c;|#0*60;)svg/i)
})
