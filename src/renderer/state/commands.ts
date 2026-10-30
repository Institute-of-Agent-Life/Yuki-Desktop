import { useLayoutEffect } from 'react'
import type { Command } from '../../shared/desktop'
import { useSessionActive } from './workspace'

export function useCommands(callback: (command: Command) => void) {
  const active = useSessionActive()
  useLayoutEffect(() => {
    if (!active) return
    const remove = window.yuki.onCommand(callback)
    const listener = (event: Event) => callback((event as CustomEvent<Command>).detail)
    window.addEventListener('yuki:command', listener)
    return () => {
      remove()
      window.removeEventListener('yuki:command', listener)
    }
  }, [callback, active])
}
