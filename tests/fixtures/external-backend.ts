import { expect, test } from '@playwright/test'
import { mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { launchShell } from './shell-app'

/** Operator-started isolated backend and Manager; this helper never restarts a deployed service. */
export async function externalBackend() {
  const base = process.env.YUKI_DESKTOP_REAL_BACKEND_URL?.replace(/\/+$/, '')
  test.skip(!base, 'Requires an explicitly selected isolated real backend and Manager.')
  const url = new URL(base!)
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(url.hostname)
  const resume = process.env.YUKI_DESKTOP_REAL_PROFILE_ROOT
  const root = await realpath(resume ?? (await mkdtemp(join(tmpdir(), 'yd-external-computer-'))))
  const parent = await realpath(tmpdir())
  const within = relative(parent, root)
  expect(!isAbsolute(within) && within !== '..' && !within.startsWith(`..${sep}`)).toBe(true)
  expect(basename(root)).toMatch(/^yd-external-computer-/)
  const response = await fetch(`${base}/__test/computer`)
  expect(response.ok).toBe(true)
  const facts = (await response.json()) as {
    external_manager: boolean
    environment: { ready: boolean; host_available_bytes: number }
  }
  expect(facts.external_manager).toBe(true)
  expect(facts.environment.ready).toBe(true)
  expect(facts.environment.host_available_bytes).toBeGreaterThan(0)
  return {
    base: base!,
    root,
    resumed: Boolean(resume),
    async code() {
      const response = await fetch(`${base}/__test/link-code`, { method: 'POST' })
      expect(response.ok).toBe(true)
      return ((await response.json()) as { code: string }).code
    },
    launch: (profile: string) =>
      launchShell(join(root, profile), process.env.YUKI_DESKTOP_EXECUTABLE),
  }
}
