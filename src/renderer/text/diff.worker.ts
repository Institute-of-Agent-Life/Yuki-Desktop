import { diffLines } from 'diff'
import { pairedDiff } from '../../shared/diff'

self.onmessage = (event: MessageEvent<{ left: string; right: string }>) => {
  const changes = pairedDiff(diffLines(event.data.left, event.data.right))
  self.postMessage(changes)
}
