import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConnectorSupervision } from '../shared/connector'
import type { Preferences } from '../shared/desktop'
import { REQUIRED_API_REVISION } from '../shared/api'

export function diagnostics(
  preferences: Preferences,
  runtime: {
    version: string
    platform: string
    arch: string
    electron: string
    chrome: string
    node: string
  },
  local: { connections: number; subscriptions: number; messages: Record<string, number> },
) {
  // This is an explicit summary, never a copy of logs, credentials or cached payloads.
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    application: runtime,
    required_api_revision: REQUIRED_API_REVISION,
    preferences: {
      theme: preferences.theme,
      time_zone: preferences.timeZone,
      opaque: preferences.opaque,
      reduced_motion: preferences.reducedMotion,
      high_contrast: preferences.highContrast,
      keep_in_tray: preferences.keepInTray,
      send_key: preferences.sendKey,
      notifications: {
        proactive: preferences.notifyProactive,
        waiting: preferences.notifyWaiting,
        completed: preferences.notifyCompleted,
        help: preferences.notifyHelp,
      },
    },
    local,
  }
}

// Enough recent history to see the last disconnects and a crash stack; older lines stay in
// the rotated files on this computer.
const LOG_TAIL_BYTES = 256 * 1024

async function tail(path: string) {
  let file
  try {
    file = await open(path, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  try {
    const { size } = await file.stat()
    const length = Math.min(size, LOG_TAIL_BYTES)
    const bytes = Buffer.alloc(length)
    await file.read(bytes, 0, length, size - length)
    return { path, size, text: bytes.toString('utf8') }
  } finally {
    await file.close()
  }
}

/** An explicit export the person saves themselves: supervision facts and both log tails. */
export async function connectorDiagnostics(input: {
  dataDirectory: string
  managed?: boolean
  version: string
  running: boolean
  supervision?: ConnectorSupervision
}) {
  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    connector: {
      version: input.version,
      managed: input.managed ?? false,
      data_directory: input.dataDirectory,
      running: input.running,
      supervision: input.supervision ?? null,
    },
    connector_log: await tail(join(input.dataDirectory, 'connector.log')),
    connector_stderr_log: await tail(join(input.dataDirectory, 'connector-stderr.log')),
  }
}
