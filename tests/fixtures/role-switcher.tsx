import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Connection, Profile } from '../../src/shared/api'
import { RoleSwitcher } from '../../src/renderer/components/RoleSwitcher'
import '../../src/renderer/tokens.css'

// Isolated component data only; this fixture never changes a real connection.
const connections: Connection[] = [
  {
    characterId: 'first-role',
    name: 'First role',
    baseUrl: 'https://first.example.invalid',
    personId: 'first-person',
    bindingId: 'first-binding',
    conversationId: 'first-conversation',
    persistentCredentials: false,
  },
  {
    characterId: 'second-role',
    name: 'Second role',
    baseUrl: 'https://second.example.invalid',
    personId: 'second-person',
    bindingId: 'second-binding',
    conversationId: 'second-conversation',
    persistentCredentials: false,
  },
]
Object.defineProperty(window, 'yuki', {
  value: {
    client: {
      read: async (id: string) => {
        const connection = connections.find((item) => item.characterId === id)!
        const profile: Profile = {
          id,
          display_name: connection.name,
          slug: id,
          bio: '',
          revision: 1,
          avatar: null,
          default_avatar: null,
          avatar_revision: 0,
          accent: { light: '#3a6bd6', dark: '#80a6ff' },
          viewer: { is_owner: false },
        }
        return { ok: true, value: profile }
      },
    },
  },
})

function Fixture() {
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get('selected') === 'second'
      ? connections[1]!.characterId
      : '',
  )
  const [selections, setSelections] = useState<string[]>([])
  return (
    <main style={{ padding: 24 }}>
      <div style={{ position: 'relative', width: 300, height: 220 }}>
        <RoleSwitcher
          connections={connections}
          selected={selected}
          select={(connection) => {
            setSelections((current) => [...current, connection.characterId])
            setSelected(connection.characterId)
          }}
        />
      </div>
      <output data-testid="selected">{selected}</output>
      <output data-testid="selection-count">{selections.length}</output>
    </main>
  )
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Fixture />
  </QueryClientProvider>,
)
