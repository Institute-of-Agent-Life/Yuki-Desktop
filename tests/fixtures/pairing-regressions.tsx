import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiReply, Connection, ConversationBridge, Meta } from '../../src/shared/api'
import { Pairing } from '../../src/renderer/views/Pairing'
import '../../src/renderer/tokens.css'

const ids = {
  a: '00000000-0000-4000-8000-000000000001',
  b: '00000000-0000-4000-8000-000000000002',
}
const requests: { server: string; code: string }[] = []
let complete: (() => void) | undefined
const client: Pick<ConversationBridge, 'pendingPairings' | 'meta' | 'pair'> = {
  pendingPairings: async () => ({ ok: true, value: [] }),
  meta: async (server) => {
    const target = new URL(server).hostname.startsWith('a.') ? 'a' : 'b'
    const value: Meta = {
      api_revision: 6,
      capabilities: ['character', 'soul'],
      server_version: 'fixture',
      character: {
        id: ids[target],
        display_name: `Character ${target.toUpperCase()}`,
        accent: { light: '#123456', dark: '#abcdef' },
        avatar_url: null,
      },
      min_client: { desktop: '1.0.0-beta.2', android: null },
    }
    return { ok: true, value }
  },
  pair: (server, code) => {
    requests.push({ server, code })
    return new Promise<ApiReply<Connection>>((resolve) => {
      complete = () =>
        resolve({
          ok: true,
          value: {
            characterId: ids.a,
            baseUrl: server,
            name: 'Character A',
            personId: '00000000-0000-4000-8000-000000000003',
            bindingId: '00000000-0000-4000-8000-000000000004',
            conversationId: '00000000-0000-4000-8000-000000000005',
            deviceId: '00000000-0000-4000-8000-000000000006',
            persistentCredentials: true,
          },
        })
    })
  },
}
Object.assign(window, { yuki: { client, onPairLink: () => () => {} } })

function Sample() {
  const [active, setActive] = useState(true)
  const [finished, setFinished] = useState<{ characterId: string; activate: boolean }[]>([])
  return (
    <QueryClientProvider client={new QueryClient()}>
      <nav aria-label="Fixture navigation">
        <button onClick={() => setActive(false)}>Hide pairing</button>
        <button onClick={() => setActive(true)}>Show pairing</button>
        <button onClick={() => complete?.()}>Complete original pairing</button>
      </nav>
      <output data-testid="finished">{JSON.stringify(finished)}</output>
      <output data-testid="requests">{JSON.stringify(requests)}</output>
      <section hidden={!active} aria-label="Pairing surface">
        <Pairing
          label="Fixture desktop"
          initialLink={null}
          startAtServer
          active={active}
          onResumeLogout={async () => {}}
          onUpdate={() => {}}
          onDone={(connection, activate = true) => {
            setFinished((items) => [...items, { characterId: connection.characterId, activate }])
            if (activate) setActive(false)
          }}
        />
      </section>
    </QueryClientProvider>
  )
}
createRoot(document.getElementById('root')!).render(<Sample />)
