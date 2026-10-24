import { createRoot } from 'react-dom/client'
import { NativeRequest } from '../../src/renderer/views/NativeRequest'
import type { ConnectorOperation, ConnectorTarget } from '../../src/shared/connector'
import '../../src/renderer/tokens.css'

const mode = new URLSearchParams(location.search).get('mode')
const project = '/isolated/native/project'
const permissions =
  mode === 'legacy'
    ? {
        fileSystem: { read: ['/isolated/notes.txt'], write: ['/isolated/output'] },
        network: { enabled: false },
      }
    : {
        fileSystem: {
          entries: [
            { access: 'write', path: { type: 'path', path: project } },
            {
              access: 'read',
              path: { type: 'glob_pattern', pattern: project + '/docs/**/*.md' },
            },
            {
              access: 'read',
              path: { type: 'special', value: { kind: 'project_roots', subpath: 'docs' } },
            },
          ],
          globScanMaxDepth: 3,
        },
        network: { enabled: true },
      }
const responses: Partial<ConnectorTarget>[] = []
Object.assign(window, { __nativeRequestedPermissions: permissions, __nativeResponses: responses })
const event: NonNullable<ConnectorOperation['events']>[number] = {
  cursor: 71,
  kind: 'permission',
  permission_id: '71',
  payload: {
    native_request_id: 22,
    native_method:
      mode === 'command'
        ? 'item/commandExecution/requestApproval'
        : 'item/permissions/requestApproval',
    native_request: {
      threadId: 'original-native-thread',
      turnId: 'original-native-turn',
      itemId: 'original-native-item',
      startedAtMs: 1792880000000,
      cwd: project,
      reason: '原操作需要這些明確範圍',
      ...(mode === 'command'
        ? {
            command: 'run original command',
            additionalPermissions: permissions,
            availableDecisions: ['accept', 'decline'],
          }
        : { permissions }),
    },
  },
}

createRoot(document.getElementById('root')!).render(
  <main style={{ maxWidth: 680, padding: 20 }}>
    <NativeRequest
      event={event}
      busy={false}
      onRespond={async (response) => {
        responses.push(response)
      }}
    />
  </main>,
)
