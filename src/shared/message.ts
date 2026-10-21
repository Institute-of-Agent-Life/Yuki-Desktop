// Match Python str.strip on the server, including NEL and excluding the BOM.
export function normalizeMessageText(text: string): string {
  const whitespace = (at: number) =>
    /\p{White_Space}/u.test(text[at]!) ||
    (text.charCodeAt(at) >= 0x1c && text.charCodeAt(at) <= 0x1f)
  let start = 0,
    end = text.length
  while (start < end && whitespace(start)) start++
  while (end > start && whitespace(end - 1)) end--
  return text.slice(start, end)
}

export interface MessageReference {
  conversationId: string
  eventId: number
}
const marker =
  /^\[\[yuki-ref conversation=([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}) event=([1-9]\d*)\]\](?:\r?\n|$)/i
export function parseMessage(text: string): { text: string; references: MessageReference[] } {
  const references: MessageReference[] = []
  let match: RegExpExecArray | null
  while ((match = marker.exec(text)) !== null) {
    const eventId = Number(match[2])
    if (!Number.isSafeInteger(eventId)) break
    references.push({ conversationId: match[1]!, eventId })
    text = text.slice(match[0].length)
  }
  return { text, references }
}
export function referencedMessage(references: MessageReference[], text: string): string {
  return (
    references
      .map((item) => `[[yuki-ref conversation=${item.conversationId} event=${item.eventId}]]\n`)
      .join('') + text
  )
}
