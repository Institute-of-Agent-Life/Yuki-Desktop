import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ApiClient } from '../../src/main/api/client'
import { ClientProblem, problemText } from '../../src/renderer/queries/client'
import { REQUIRED_API_REVISION } from '../../src/shared/api'

const contract = JSON.parse(
  readFileSync(new URL('../../contracts/client-api.openapi.json', import.meta.url), 'utf8'),
)
const codes = [
  'unauthenticated',
  'owner_required',
  'not_found',
  'request_conflict',
  'version_conflict',
  'precondition_failed',
  'validation_error',
  'unavailable',
  'unknown',
]
it('requires the API revision in the fixed backend contract', () => {
  expect(REQUIRED_API_REVISION).toBe(contract.info['x-yuki-api-revision'])
})
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
it.each([
  ['expired', '已過期'],
  ['cleaned', '已清理'],
  ['source_unavailable', '無法從原平台取得'],
  ['source_changed', '原附件已變更，請重新讀取訊息。'],
])(
  'preserves media reason %s through the API error and readable UI message',
  async (reason, message) => {
    const client = new ApiClient(
      'http://localhost',
      undefined,
      undefined,
      '1.0.0-beta.1',
      async () =>
        Response.json({ problem: { code: 'media_unavailable', reason } }, { status: 409 }),
    )
    await expect(client.get('attachment')).rejects.toMatchObject({
      code: 'media_unavailable',
      reason,
    })
    expect(new ClientProblem('media_unavailable', reason).message).toBe(message)
  },
)

it.each([
  Response.json({ detail: 'Not Found' }, { status: 404 }),
  new Response('<h1>Not Found</h1>', { status: 404 }),
])('identifies a missing public metadata endpoint before pairing', async (response) => {
  const client = new ApiClient(
    'http://localhost',
    undefined,
    undefined,
    undefined,
    async () => response,
  )
  await expect(client.get('meta')).rejects.toMatchObject({ code: 'client_api_unavailable' })
  expect(problemText('client_api_unavailable')).toBe(
    '此位址未提供桌面連線介面，請確認位址或更新 Yuki。',
  )
})
it.each([
  ['home', Response.json({ detail: 'Not Found' }, { status: 404 }), 'unknown'],
  ['meta', Response.json({ problem: { code: 'not_found' } }, { status: 404 }), 'not_found'],
  ['meta', Response.json({ problem: { code: 'unknown' } }, { status: 404 }), 'unknown'],
  [
    'meta',
    Response.json({ problem: { code: 'unauthenticated' } }, { status: 401 }),
    'unauthenticated',
  ],
  ['meta', Response.json({ detail: 'Internal error' }, { status: 500 }), 'unknown'],
] as const)('preserves non-metadata-missing failures for %s', async (path, response, code) => {
  const client = new ApiClient(
    'http://localhost',
    undefined,
    undefined,
    undefined,
    async () => response,
  )
  await expect(client.get(path)).rejects.toMatchObject({ code })
})
