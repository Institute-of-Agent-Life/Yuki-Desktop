import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { Connection, Profile } from '../../shared/api'
import { characterPresence } from '../../shared/presence'
import { unwrap } from '../queries/client'
import { useSessionActive } from '../state/workspace'
import { CharacterAvatar, CharacterVisuals } from './CharacterAvatar'
import { IconButton } from './Controls'
import styles from './RoleSwitcher.module.css'

function Role({
  connection,
  selected,
  choose,
}: {
  connection: Connection
  selected: boolean
  choose(): void
}) {
  const id = connection.characterId
  const profile = useQuery({
    queryKey: [id, 'character'],
    queryFn: () => window.yuki.client.read<Profile>(id, { kind: 'character' }).then(unwrap),
    retry: false,
  })
  const name = profile.data?.display_name ?? connection.name
  const presence = characterPresence(
    profile.isError ? 'offline' : profile.data ? 'online' : 'connecting',
  )
  return (
    <CharacterVisuals.Provider value={{ id, name, profile: profile.data }}>
      <button
        role="menuitemradio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        onClick={choose}
        title={connection.baseUrl}
        className={styles.role}
      >
        <CharacterAvatar size={32} />
        <span>
          <strong>{name}</strong>
          <small>
            {connection.needsPairing
              ? '需要重新配對'
              : connection.logout
                ? '登出尚未完成'
                : presence.text}
          </small>
        </span>
        {selected && <Check size={16} aria-hidden="true" />}
      </button>
    </CharacterVisuals.Provider>
  )
}
export function RoleSwitcher({
  connections,
  selected,
  select,
}: {
  connections: Connection[]
  selected: string
  select(connection: Connection): void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const active = useSessionActive()
  const close = () => {
    setOpen(false)
    root.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
  }
  useEffect(() => {
    if (!active) setOpen(false)
  }, [active])
  useEffect(() => {
    if (!open || !active) return
    const focusTarget =
      root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      root.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
    focusTarget?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, active])
  return (
    <div ref={root} className={styles.switcher} onClick={(event) => event.stopPropagation()}>
      <IconButton
        label="切換角色"
        aria-haspopup="menu"
        aria-expanded={open && active}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronsUpDown size={14} strokeWidth={1.5} />
      </IconButton>
      {open && active && (
        <div
          role="menu"
          aria-label="角色"
          className={styles.menu}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
          }}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
            ]
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
              buttons[next]?.focus()
            }
          }}
        >
          {connections.map((connection) => (
            <Role
              key={connection.characterId}
              connection={connection}
              selected={selected === connection.characterId}
              choose={() => {
                close()
                select(connection)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
