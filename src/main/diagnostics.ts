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
