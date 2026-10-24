import { expect, type Page } from '@playwright/test'
import type { Profile } from '../../src/shared/api'

export async function activeCharacterName(page: Page): Promise<string> {
  const session = page.locator('[data-character-session]').filter({ visible: true })
  await expect(session).toHaveCount(1)
  const id = (await session.getAttribute('data-character-session'))!
  return page.evaluate(async (id) => {
    const result = await window.yuki.client.read<Profile>(id, { kind: 'character' })
    if (!result.ok) throw Error(result.code)
    return result.value.display_name
  }, id)
}
