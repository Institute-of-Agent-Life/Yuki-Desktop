import MarkdownIt from 'markdown-it'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { useEffect, useState } from 'react'
import type { ArtifactSource, AttachmentSource } from '../../shared/api'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false })
markdown.disable(['html_block', 'html_inline'])
const ordinaryLink = markdown.validateLink
markdown.validateLink = (href) =>
  href.startsWith('artifact:') || href.startsWith('attachment:') || ordinaryLink(href)
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]!,
    href = String(token.attrGet('src') ?? ''),
    alt = token.content
  return internalImage(href)
    ? `<span data-media-ref="${markdown.utils.escapeHtml(href)}" role="img" aria-label="${markdown.utils.escapeHtml(alt)}">${markdown.utils.escapeHtml(alt || '圖片')}</span>`
    : `<a href="${markdown.utils.escapeHtml(href)}">${markdown.utils.escapeHtml(alt || href)}</a>`
}
export function internalImage(href: string): ArtifactSource | AttachmentSource | undefined {
  const artifact = /^artifact:([a-f0-9-]{36})@([a-f0-9]{64})$/i.exec(href)
  if (artifact) return { artifactId: artifact[1]!, version: artifact[2]!.toLowerCase() }
  const attachment = /^attachment:([a-f0-9-]{36})\/(\d+)\/(\d+)$/i.exec(href)
  if (attachment)
    return {
      conversationId: attachment[1]!,
      eventId: Number(attachment[2]),
      index: Number(attachment[3]),
    }
}
let math: typeof import('katex') | undefined
let mathEngine: Promise<void> | undefined
markdown.inline.ruler.before('escape', 'math', (state, silent) => {
  const start = state.pos,
    display = state.src.startsWith('$$', start),
    marker = display ? '$$' : '$'
  if (
    !state.src.startsWith(marker, start) ||
    (!display && /\s/.test(state.src[start + marker.length] ?? ''))
  )
    return false
  let end = state.src.indexOf(marker, start + marker.length)
  while (end !== -1 && state.src[end - 1] === '\\')
    end = state.src.indexOf(marker, end + marker.length)
  if (end === -1 || (!display && state.src.slice(start + 1, end).includes('\n'))) return false
  if (!silent) {
    const token = state.push('math', '', 0)
    token.content = state.src.slice(start + marker.length, end)
    token.block = display
  }
  state.pos = end + marker.length
  return true
})
markdown.renderer.rules.math = (tokens, index) => {
  const token = tokens[index]!
  return math
    ? math.renderToString(token.content, {
        displayMode: token.block,
        throwOnError: false,
        trust: false,
      })
    : markdown.utils.escapeHtml(
        `${token.block ? '$$' : '$'}${token.content}${token.block ? '$$' : '$'}`,
      )
}
const copyButton = '<button type="button" data-code-copy aria-label="複製程式碼">複製</button>'
const highlighter = createHighlighterCore({
  engine: createJavaScriptRegexEngine(),
  themes: [
    import('@shikijs/themes/github-light'),
    import('@shikijs/themes/github-dark'),
    import('@shikijs/themes/github-light-high-contrast'),
    import('@shikijs/themes/github-dark-high-contrast'),
  ],
  langs: [
    import('@shikijs/langs/javascript'),
    import('@shikijs/langs/typescript'),
    import('@shikijs/langs/tsx'),
    import('@shikijs/langs/json'),
    import('@shikijs/langs/python'),
    import('@shikijs/langs/shellscript'),
    import('@shikijs/langs/html'),
    import('@shikijs/langs/css'),
    import('@shikijs/langs/yaml'),
    import('@shikijs/langs/sql'),
    import('@shikijs/langs/markdown'),
  ],
}).then((highlighter) => {
  markdown.renderer.rules.fence = (tokens, index) => {
    const token = tokens[index]!,
      language = token.info.trim().split(/\s+/)[0] ?? 'text'
    if (language === 'mermaid')
      return `<div data-mermaid><pre>${markdown.utils.escapeHtml(token.content)}</pre></div>`
    const html = highlighter.codeToHtml(token.content, {
      lang: highlighter.getLoadedLanguages().includes(language) ? language : 'text',
      themes: {
        light: 'github-light',
        dark: 'github-dark',
        'contrast-light': 'github-light-high-contrast',
        'contrast-dark': 'github-dark-high-contrast',
      },
      defaultColor: false,
    })
    return `<div class="code-block">${copyButton}${html}</div>`
  }
  return highlighter
})
export async function renderCode(text: string, language: string) {
  const instance = await highlighter
  return instance.codeToHtml(text, {
    lang: instance.getLoadedLanguages().includes(language) ? language : 'text',
    themes: {
      light: 'github-light',
      dark: 'github-dark',
      'contrast-light': 'github-light-high-contrast',
      'contrast-dark': 'github-dark-high-contrast',
    },
    defaultColor: false,
  })
}
export async function renderMarkdown(text: string) {
  await highlighter
  if (text.includes('$')) {
    mathEngine ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(
      ([engine]) => {
        math = engine
      },
    )
    await mathEngine
  }
  return markdown.render(text)
}
export function useMarkdown(text: string) {
  const [html, setHtml] = useState(() => markdown.render(text))
  useEffect(() => {
    let current = true
    setHtml(markdown.render(text))
    void renderMarkdown(text)
      .then((value) => {
        if (current) setHtml(value)
      })
      .catch(() => {
        // The already rendered text remains readable if a local optional engine fails to load.
      })
    return () => {
      current = false
    }
  }, [text])
  return html
}
