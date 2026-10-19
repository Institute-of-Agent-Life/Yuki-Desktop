import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ApiClient } from '../../src/main/api/client'
import { problemText } from '../../src/renderer/queries/client'

const codes = JSON.parse(
  readFileSync(new URL('../../contracts/client-api.openapi.json', import.meta.url), 'utf8'),
).components.schemas.PublicProblemCode.enum as string[]
it.each(codes)('keeps the public problem code %s and provides a readable message', async (code) => {
  const client = new ApiClient(
    'http://localhost',
    'test-only',
    undefined,
    '1.0.0-beta.1',
    async () => Response.json({ problem: { code } }, { status: 409 }),
  )
  await expect(client.get('home')).rejects.toMatchObject({ code })
  expect(problemText(code)).not.toContain('操作未完成（')
})
