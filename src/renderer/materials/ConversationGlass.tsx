import styles from './ConversationGlass.module.css'

// Bubbles and work cards are content: a tinted pane with a drawn rim, no lens and no filter.
export function ConversationGlass({ kind }: { kind: 'bubble' | 'work-card' }) {
  return <span data-glass={kind} className={styles.surface} aria-hidden="true" />
}
