import { useCallback } from 'react'
import { watchAppearance } from './appearance'
import styles from './ConversationGlass.module.css'

// Bubbles and work cards are content, not glass (HIG Materials: no Liquid Glass in the content
// layer): a plain fill, with no rim, lens or filter. Over a picture of one's own each takes the
// appearance of what lies under it (appearance.ts), with its text.
export function ConversationGlass({ kind }: { kind: 'bubble' | 'work-card' }) {
  const watch = useCallback(
    (node: HTMLSpanElement | null) => (node ? watchAppearance(node.parentElement!) : undefined),
    [],
  )
  return <span ref={watch} data-surface={kind} className={styles.surface} aria-hidden="true" />
}
