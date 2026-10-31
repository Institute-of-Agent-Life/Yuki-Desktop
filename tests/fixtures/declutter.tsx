import { createRoot } from 'react-dom/client'
import { WorkCard } from '../../src/renderer/components/Content'
import type { Status } from '../../src/renderer/components/Controls'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'

const examples: [Status, string, string][] = [
  ['done', '已完成', '整理這份很長的研究資料並保留原始成果與所有來源以便稍後繼續查看'.repeat(3)],
  [
    'running',
    '執行中',
    'Investigate the original request and retain every published artifact '.repeat(4),
  ],
  ['waiting', '等你回覆', 'AReallyLongUnbrokenWorkTitle'.repeat(10)],
  ['failed', '未完成', '檢查失敗原因並繼續原工作'.repeat(10)],
  ['unknown', '結果未確認', 'OriginalExecutionIdentity'.repeat(10)],
]
createRoot(document.getElementById('root')!).render(
  <main style={{ padding: 16 }}>
    {examples.map(([status, label, title]) => (
      <WorkCard
        key={status}
        status={status}
        statusLabel={label}
        title={title}
        onOpen={() => {}}
        question={status === 'waiting' ? '請確認原工作需要的城市' : undefined}
        onReply={() => {}}
        onCancel={status === 'waiting' || status === 'running' ? () => {} : undefined}
      />
    ))}
  </main>,
)
