import styles from './ConversationGlass.module.css'

// Bubbles and work cards are content, not glass (HIG Materials: no Liquid Glass in the content
// layer): a plain fill, with no rim, lens or filter.
export function ConversationGlass({ kind }: { kind: 'bubble' | 'work-card' }) {
  return <span data-surface={kind} className={styles.surface} aria-hidden="true" />
}
