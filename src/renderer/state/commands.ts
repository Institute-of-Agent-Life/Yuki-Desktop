import { useEffect } from 'react'
import type { Command } from '../../shared/desktop'

export function useCommands(callback: (command: Command) => void) {
  useEffect(() => {
    const remove = window.yuki.onCommand(callback)
    const listener = (event: Event) => callback((event as CustomEvent<Command>).detail)
    window.addEventListener('yuki:command', listener)
    return () => {
      remove()
      window.removeEventListener('yuki:command', listener)
    }
  }, [callback])
}
