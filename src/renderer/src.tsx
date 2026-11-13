import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './tokens.css'
import './materials/materials.css'
import { keyboardCommand } from '../shared/commands'
import { applyLanguage, t } from './i18n'
import { systemLanguage } from '../shared/locales'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
})
window.yuki
  .boot()
  .then((boot) => {
    applyLanguage(boot.language)
    window.yuki.onLanguage(applyLanguage)
    window.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return
      const command = keyboardCommand(
        {
          key: event.key,
          meta: event.metaKey,
          control: event.ctrlKey,
          shift: event.shiftKey,
          alt: event.altKey,
        },
        boot.platform,
      )
      if (command) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('yuki:command', { detail: command }))
      }
    })
    createRoot(document.getElementById('root')!).render(
      <QueryClientProvider client={queryClient}>
        <App boot={boot} />
      </QueryClientProvider>,
    )
  })
  .catch(() => {
    // Without boot there is no saved preference; the system language is the default one.
    applyLanguage(systemLanguage(navigator.languages))
    document.getElementById('root')!.textContent = t('workspace:bootFailed')
  })
