import type { Command } from './desktop'

export function keyboardCommand(
  input: { key: string; meta: boolean; control: boolean; shift: boolean; alt: boolean },
  platform: string,
): Command | undefined {
  if (!(platform === 'darwin' ? input.meta : input.control)) return
  const key = input.key.toLowerCase()
  return input.shift && key === 'e'
    ? 'focus-mode'
    : key === 's' && (platform === 'darwin' ? input.control : input.shift)
      ? 'sidebar'
      : key === 'i' && input.alt
        ? 'inspector'
        : key === ','
          ? 'settings'
          : key === 'k'
            ? 'search'
            : key === 'f'
              ? 'find'
              : key === 'n'
                ? 'focus-composer'
                : (
                    {
                      '1': 'chat',
                      '2': 'works',
                      '3': 'computer',
                      '4': 'files',
                      '5': 'about',
                    } as Record<string, Command>
                  )[key]
}
