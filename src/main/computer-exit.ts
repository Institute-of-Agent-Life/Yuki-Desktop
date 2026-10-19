import type { Computer, Connection } from '../shared/api'
import type { Connections } from './connections'
import { ApiError } from './api/client'

export interface HeldComputer {
  connection: Connection
  leaseId: string
  offline: boolean
}
export async function heldComputers(connections: Connections): Promise<HeldComputer[]> {
  const held: HeldComputer[] = []
  for (const connection of connections.list()) {
    if (connection.logout) continue
    let offline = false
    let state: Pick<Computer, 'control'> | undefined
    try {
      state = await connections.read<Computer>(connection.characterId, { kind: 'computer' }, false)
    } catch (error) {
      if (
        error instanceof ApiError &&
        [
          'unauthenticated',
          'owner_required',
          'not_found',
          'outbox_owner_mismatch',
          'different_character',
        ].includes(error.code)
      )
        continue
      offline = true
      state = connections.box(connection.characterId).cached<Computer>('computer')
      const original = connections
        .computerCommands(connection.characterId)
        .list()
        .filter((item) => item.state === 'result' && !item.problem)
        .at(-1)
      if (!state && original?.result && 'control' in original.result)
        state = { control: original.result.control ?? null }
    }
    if (
      state?.control?.holder === 'human' &&
      state.control.device_id === connection.deviceId &&
      state.control.lease_id
    )
      held.push({ connection, leaseId: state.control.lease_id, offline })
  }
  return held
}
