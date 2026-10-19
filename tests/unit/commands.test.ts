import { expect, it } from 'vitest'
import { keyboardCommand } from '../../src/shared/commands'
it.each(['darwin', 'win32', 'linux'])(
  'recognizes shifted bracket keys for role switching on %s',
  (platform) => {
    const modifiers = {
      meta: platform === 'darwin',
      control: platform !== 'darwin',
      shift: true,
      alt: false,
    }
    for (const key of ['[', '{'])
      expect(keyboardCommand({ ...modifiers, key }, platform)).toBe('previous-character')
    for (const key of [']', '}'])
      expect(keyboardCommand({ ...modifiers, key }, platform)).toBe('next-character')
    expect(
      keyboardCommand({ ...modifiers, meta: false, control: false, key: '}' }, platform),
    ).toBeUndefined()
  },
)
