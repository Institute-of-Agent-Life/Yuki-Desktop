import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import './tokens.css'
import './materials/materials.css'
import { keyboardCommand } from '../shared/commands'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
})
window.yuki
  .boot()
  .then((boot) => {
    window.addEventListener('keydown', (event) => {
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
    document.getElementById('root')!.textContent = '無法開啟本機資料，請重新啟動 Yuki。'
  })
