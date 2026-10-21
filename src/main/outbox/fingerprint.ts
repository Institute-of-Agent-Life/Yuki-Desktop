import { createHash } from 'node:crypto'

// Match client_api.commands.fingerprint: sorted keys, compact JSON and ASCII escapes.
export function payloadHash(operation: string, target: string, payload: unknown): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : value !== null && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sort(item)]),
          )
        : value
  const encoded = JSON.stringify(sort([operation, target, payload])).replace(
    /[\u007F-\uFFFF]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  return createHash('sha256').update(encoded).digest('hex')
}
