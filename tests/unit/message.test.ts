import { expect, it } from 'vitest'
import { parseMessage, referencedMessage } from '../../src/shared/message'

const first = { conversationId: '00000000-0000-4000-8000-000000000001', eventId: 18 }
const second = { ...first, eventId: 22 }
it('restores multiple references from the durable draft and handles reference-only messages', () => {
  expect(parseMessage(referencedMessage([first, second], '繼續這兩件事'))).toEqual({
    references: [first, second],
    text: '繼續這兩件事',
  })
  expect(parseMessage(referencedMessage([first], '').trimEnd())).toEqual({
    references: [first],
    text: '',
  })
})
it('keeps inline markers and invalid IDs as ordinary user text', () => {
  for (const text of [
    'example ' + referencedMessage([first], ''),
    referencedMessage([{ ...first, eventId: 0 }], ''),
    referencedMessage([{ ...first, eventId: Number.MAX_SAFE_INTEGER + 1 }], ''),
  ]) {
    expect(parseMessage(text)).toEqual({ text, references: [] })
  }
})
