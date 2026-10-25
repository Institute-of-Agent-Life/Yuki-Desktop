import type { Page } from '@playwright/test'
import type { Connection } from '../../src/shared/api'
import type { ExecutorHistory } from '../../src/shared/executor'

export async function executorOperation(
  page: Page,
  owner: Connection,
  executorId: string,
  opId: string,
) {
  return page.evaluate(
    async ({ id, executorId, opId }) => {
      const result = await window.yuki.client.read<ExecutorHistory>(id, {
        kind: 'executor-operations',
        executorId,
      })
      if (!result.ok) throw Error(result.code)
      return result.value.items.find((item) => item.op_id === opId)
    },
    { id: owner.characterId, executorId, opId },
  )
}
