import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Profile } from '../../src/shared/api'
import { About } from '../../src/renderer/views/About'
import { CharacterAvatar, CharacterVisuals } from '../../src/renderer/components/CharacterAvatar'
import { Workspace } from '../../src/renderer/components/Workspace'
import { WorkspaceSession, workspaceFor } from '../../src/renderer/state/workspace'
import appStyles from '../../src/renderer/App.module.css'
import '../../src/renderer/tokens.css'

const parameters = new URLSearchParams(location.search)
const profile: Profile = {
  id: 'about-profile-fixture',
  slug: 'about-profile-fixture',
  display_name: 'Yuki',
  bio:
    parameters.get('bio') === 'long'
      ? Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 段原始簡介。`).join('\n') +
        '\nhttps://example.invalid/' +
        'long-original-text/'.repeat(40)
      : '',
  revision: 1,
  avatar: null,
  default_avatar: null,
  avatar_revision: 0,
  accent: { light: '#3a6bd6', dark: '#80a6ff' },
}
Object.defineProperty(window, 'yuki', {
  value: {
    onCommand: () => () => {},
    client: {
      characterCommands: async () => ({
        ok: true,
        value:
          parameters.get('pending') === 'avatar'
            ? [
                {
                  requestId: 'original-avatar-request',
                  command: { kind: 'avatar', action: 'reset', expectedRevision: 0 },
                  state: 'submitted',
                  problem: null,
                },
              ]
            : [],
      }),
      read: async (_id: string, route: { kind: string; about?: string }) => {
        if (route.kind === 'me')
          return { ok: true, value: { is_superuser: parameters.get('administrator') !== 'false' } }
        const full = parameters.get('collections') === 'full'
        if (route.kind === 'capabilities')
          return {
            ok: true,
            value: {
              plugins: full
                ? [{ id: 'original-plugin', name: '原有擴充', description: '原有能力說明' }]
                : [],
              environment: { desktop: false, tools: [] },
            },
          }
        if (route.kind === 'memory-fact') return { ok: true, value: { evidence: [] } }
        if (route.kind === 'memory')
          return {
            ok: true,
            value: {
              items: full
                ? [
                    {
                      fact_id: route.about === 'self' ? 2 : 1,
                      key: 'original',
                      kind: 'fact',
                      text: route.about === 'self' ? 'Yuki 的原有自我記憶' : '原有的個人記憶',
                      confidence: 1,
                      evidence_count: 0,
                      revision: 'original',
                      updated_at: '2026-10-24T00:00:00Z',
                      scope: route.about === 'self' ? 'self' : 'person',
                      writable: route.about !== 'self',
                    },
                  ]
                : [],
              next_cursor: null,
            },
          }
        return {
          ok: true,
          value: {
            items: full
              ? [
                  {
                    automation_id: 1,
                    title: '原有的安排',
                    schedule_text: '每天早上',
                    state: 'active',
                    revision: 'original',
                    conversation_id: null,
                    next_run_at: null,
                  },
                ]
              : [],
            next_cursor: null,
          },
        }
      },
      serverInfo: async () =>
        parameters.get('avatar') === 'error'
          ? { ok: false, code: 'unavailable' }
          : {
              ok: true,
              value: {
                capabilities: parameters.get('avatar') === 'supported' ? ['character_avatar'] : [],
              },
            },
    },
  },
})
workspaceFor('about-profile-fixture').getState().setView('about')
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <WorkspaceSession scope="about-profile-fixture" active>
      <CharacterVisuals.Provider value={{ id: profile.id, name: profile.display_name, profile }}>
        <main className={appStyles.app}>
          <Workspace
            name={profile.display_name}
            avatar={<CharacterAvatar />}
            status="已連接"
            platform="win32"
            floating={false}
          >
            <About
              id={profile.id}
              server="https://example.invalid"
              profile={profile}
              jump={async () => false}
              editSoul={() => {}}
            />
          </Workspace>
        </main>
      </CharacterVisuals.Provider>
    </WorkspaceSession>
  </QueryClientProvider>,
)
