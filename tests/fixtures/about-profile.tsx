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
  viewer: { is_owner: parameters.get('owner') === 'true' },
}
Object.defineProperty(window, 'yuki', {
  value: {
    onCommand: () => () => {},
    client: { characterCommands: async () => ({ ok: true, value: [] }) },
  },
})
workspaceFor('about-profile-fixture').getState().setView('about')
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <WorkspaceSession scope="about-profile-fixture" active>
      <CharacterVisuals.Provider value={{ id: profile.id, name: profile.display_name, profile }}>
        <main className={appStyles.app}>
          <Workspace
            name={profile.display_name}
            avatar={<CharacterAvatar />}
            status="已連接"
            owner={profile.viewer.is_owner}
            platform="win32"
            floating={false}
          >
            <About id={profile.id} profile={profile} editSoul={() => {}} />
          </Workspace>
        </main>
      </CharacterVisuals.Provider>
    </WorkspaceSession>
  </QueryClientProvider>,
)
