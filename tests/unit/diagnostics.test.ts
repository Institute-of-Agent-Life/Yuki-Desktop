import { expect, it } from 'vitest'
import { diagnostics } from '../../src/main/diagnostics'
import { defaultPreferences } from '../../src/shared/desktop'
it('exports explicit diagnostic fields rather than copying stored private payloads', () => {
  const secret = 'fixture-secret-must-not-export',
    body = 'private message text'
  const preferences = { ...defaultPreferences, token: secret, message: body }
  const value = diagnostics(
    preferences,
    {
      version: '1.0.0-beta.1',
      platform: 'darwin',
      arch: 'arm64',
      electron: '42',
      chrome: '148',
      node: '24',
    },
    { connections: 2, subscriptions: 1, messages: { submitted: 3 } },
  )
  const raw = JSON.stringify(value)
  expect(raw).not.toContain(secret)
  expect(raw).not.toContain(body)
  expect(value.local).toEqual({ connections: 2, subscriptions: 1, messages: { submitted: 3 } })
  expect(value).toHaveProperty('required_api_revision', 8)
})
