import { useConversationGlass } from './glass'
import styles from './ConversationGlass.module.css'

export function ConversationGlass({ kind }: { kind: 'bubble' | 'work-card' }) {
  const glass = useConversationGlass()
  return <span ref={glass} data-glass={kind} className={styles.surface} aria-hidden="true" />
}
