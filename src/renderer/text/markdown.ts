import MarkdownIt from 'markdown-it'
import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { useEffect, useState } from 'react'

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false })
markdown.disable(['image', 'html_block', 'html_inline'])
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
  return markdown.render(text)
}
export function useMarkdown(text: string) {
  const [html, setHtml] = useState(() => markdown.render(text))
  useEffect(() => {
    let current = true
    setHtml(markdown.render(text))
    void renderMarkdown(text).then((value) => {
      if (current) setHtml(value)
    })
    return () => {
      current = false
    }
  }, [text])
  return html
}
