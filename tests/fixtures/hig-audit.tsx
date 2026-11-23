// HIG audit target prototypes (research only). Static mocks of Settings, the conversation and
// pairing, styled by hig-audit.css; ?page=settings|look|chat|pairing|tokens|motion&theme=dark.
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUp,
  Bell,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Clipboard,
  Cpu,
  Download,
  Ellipsis,
  Folder,
  Laptop,
  Link,
  MessageCircle,
  MessagesSquare,
  Mic,
  Monitor,
  Network,
  Palette,
  PanelLeft,
  PanelRight,
  PenLine,
  Plus,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  Terminal,
  Wrench,
} from 'lucide-react'
import { sampleSpring, springs, type SpringConfig } from '../../src/renderer/motion/spring'
import './hig-audit.css'

const parameters = new URLSearchParams(location.search)
const page = parameters.get('page') ?? 'settings'
if (parameters.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark'
const avatar = new URL('./showcase-avatar.png', import.meta.url).href
// Lucide's 24-unit stroke of 2 draws 1.33px at 16px, close to SF Symbols Regular beside 13pt text.
const icon = { size: 16, strokeWidth: 2 } as const

function Lights() {
  return (
    <span className="h-lights" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}

function Row({ children, current }: { children: ReactNode; current?: boolean }) {
  return (
    <button className="h-row" aria-current={current ? 'page' : undefined}>
      {children}
    </button>
  )
}

function Window({
  sidebar,
  toolbar,
  children,
  overlay,
}: {
  sidebar?: ReactNode
  toolbar: ReactNode
  children: ReactNode
  overlay?: ReactNode
}) {
  return (
    <main className="h-window" data-bare={sidebar ? undefined : ''} data-testid="prototype">
      {sidebar && (
        <nav className="h-sidebar" aria-label="側欄">
          {sidebar}
        </nav>
      )}
      <section className="h-main">
        <div className="h-edge" aria-hidden="true" />
        <header className="h-toolbar">{toolbar}</header>
        <div className="h-content">{children}</div>
        {overlay}
      </section>
    </main>
  )
}

const settingsGroups = [
  {
    heading: '應用程式',
    items: [
      [SlidersHorizontal, '一般', 'settings'],
      [Palette, '外觀', 'look'],
      [Bell, '通知', ''],
      [Download, '更新', ''],
    ],
  },
  {
    heading: 'Yuki',
    items: [
      [Server, '連線', ''],
      [Cpu, '模型', ''],
      [MessagesSquare, '平台', ''],
      [ShieldCheck, '裝置', ''],
      [Laptop, '這台電腦', ''],
    ],
  },
  {
    heading: '',
    items: [
      [Snowflake, '所有 Yuki', ''],
      [Wrench, '進階', ''],
    ],
  },
] as const

function SettingsSidebar() {
  return (
    <>
      <div className="h-sidebar-top">
        <Lights />
      </div>
      <div className="h-search">
        <Search size={14} strokeWidth={2} />
        搜尋
      </div>
      {settingsGroups.map((group) => (
        <div key={group.heading || 'more'}>
          {group.heading === 'Yuki' ? (
            <div className="h-section" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <img className="h-avatar" src={avatar} alt="" style={{ width: 16, height: 16 }} />
              Yuki
            </div>
          ) : group.heading ? (
            <div className="h-section">{group.heading}</div>
          ) : (
            <div style={{ height: 12 }} />
          )}
          {group.items.map(([Icon, label, id]) => (
            <Row key={label} current={id === page}>
              <Icon {...icon} />
              {label}
            </Row>
          ))}
        </div>
      ))}
    </>
  )
}

function Popup({ children }: { children: ReactNode }) {
  return (
    <span className="h-popup" role="button">
      {children}
      <ChevronsUpDown size={12} strokeWidth={2.25} />
    </span>
  )
}

function FormRow({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="h-form-row">
      <div>
        <span data-text="body">{title}</span>
        {note && <small data-text="body">{note}</small>}
      </div>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="h-form-section">
      <h3>{title}</h3>
      <div className="h-form">{children}</div>
    </section>
  )
}

function Settings() {
  const general = page === 'settings'
  return (
    <Window
      sidebar={<SettingsSidebar />}
      toolbar={
        <>
          <div className="h-group h-glass">
            <button className="h-tool" aria-label="返回對話" title="返回對話">
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
          </div>
          <div className="h-title">
            <b className="h-title-lg">{general ? '一般' : '外觀'}</b>
          </div>
        </>
      }
    >
      <div className="h-page">
        {general ? (
          <>
            <Section title="語言">
              <FormRow title="介面語言">
                <Popup>跟隨系統</Popup>
              </FormRow>
            </Section>
            <Section title="啟動">
              <FormRow title="登入時開啟" note="使用正式安裝版後可設定。">
                <span className="h-switch" />
              </FormRow>
              <FormRow
                title="關閉視窗後保留在系統匣"
                note="Linux 桌面需支援 AppIndicator 才會顯示系統匣圖示。"
              >
                <span className="h-switch" data-on="" />
              </FormRow>
            </Section>
            <Section title="輸入">
              <FormRow title="送出訊息">
                <span className="h-segmented">
                  <span data-on="">Enter</span>
                  <span>Ctrl Enter</span>
                </span>
              </FormRow>
            </Section>
            <Section title="時間">
              <FormRow title="時間顯示" note="只影響這台電腦顯示的時間。">
                <Popup>台北時間（UTC+8）</Popup>
              </FormRow>
            </Section>
          </>
        ) : (
          <>
            <Section title="外觀">
              <FormRow title="主題">
                <span className="h-segmented">
                  <span data-on="">跟隨系統</span>
                  <span>淺色</span>
                  <span>深色</span>
                </span>
              </FormRow>
              <FormRow title="視窗材質" note="透明磨砂讓桌面從所有畫面透出；不透明時一律使用實色。">
                <span className="h-segmented">
                  <span data-on="">透明磨砂</span>
                  <span>不透明</span>
                </span>
              </FormRow>
              <FormRow title="對話背景" note="疊在對話底下、玻璃之後的圖案。">
                <span className="h-swatches">
                  {[
                    ['無', 'var(--window)'],
                    ['光線', 'linear-gradient(132deg,#dfe8fb,#c7d6f6)'],
                    ['極光', 'linear-gradient(135deg,#9ab9ff,#c8a2ff 50%,#8fe0d4)'],
                    ['晚霞', 'linear-gradient(135deg,#ffc08a,#ff9db0 50%,#b59af0)'],
                    [
                      '格線',
                      'repeating-linear-gradient(0deg,var(--fill-1) 0 1px,transparent 1px 8px)',
                    ],
                  ].map(([name, fill], index) => (
                    <span key={name} className="h-swatch" data-on={index === 0 ? '' : undefined}>
                      <i style={{ background: fill }} />
                      {name}
                    </span>
                  ))}
                </span>
              </FormRow>
            </Section>
            <Section title="輔助使用">
              <FormRow title="減少動態" note="減少介面的位移與過場。">
                <span className="h-switch" />
              </FormRow>
              <FormRow title="增加對比">
                <span className="h-switch" />
              </FormRow>
            </Section>
          </>
        )}
      </div>
    </Window>
  )
}

function ChatSidebar() {
  return (
    <>
      <div className="h-sidebar-top">
        <Lights />
        <button className="h-tool" aria-label="隱藏側欄" style={{ width: 28, height: 28 }}>
          <PanelLeft {...icon} />
        </button>
      </div>
      <div className="h-presence">
        <img className="h-avatar" src={avatar} alt="" />
        <div>
          <b>Yuki</b>
          <small>
            <span className="h-dot" style={{ width: 6, height: 6, marginRight: 4 }} />
            已連線
          </small>
        </div>
      </div>
      <div className="h-section">對話</div>
      <Row current>
        <MessageCircle {...icon} />
        桌面對話
      </Row>
      <div className="h-section">工作區</div>
      <Row>
        <BriefcaseBusiness {...icon} />
        工作
      </Row>
      <Row>
        <Folder {...icon} />
        檔案與成果
      </Row>
      <Row>
        <Monitor {...icon} />
        Yuki 的電腦
      </Row>
      <Row>
        <Laptop {...icon} />
        這台電腦
      </Row>
    </>
  )
}

function Message({ own, text, meta }: { own?: boolean; text: string; meta?: string }) {
  return (
    <div className="h-msg-wrap" data-own={own ? '' : undefined}>
      {meta && <div className="h-meta">{meta}</div>}
      <div className="h-msg" data-own={own ? '' : undefined}>
        {!own && <img className="h-avatar" src={avatar} alt="" />}
        <div className="h-bubble" data-text="body">
          {text}
        </div>
      </div>
    </div>
  )
}

function Chat() {
  return (
    <Window
      sidebar={<ChatSidebar />}
      toolbar={
        <>
          <div className="h-title">
            <b>桌面對話</b>
            <small>Yuki · 已連線</small>
          </div>
          <div className="h-group h-glass">
            <button className="h-tool" aria-label="搜尋">
              <Search {...icon} />
            </button>
            <button className="h-tool" aria-label="檢閱器">
              <PanelRight {...icon} />
            </button>
          </div>
          <div className="h-group h-glass">
            <button className="h-tool" aria-label="更多">
              <Ellipsis {...icon} />
            </button>
          </div>
        </>
      }
      overlay={
        <div className="h-composer h-glass">
          <button className="h-tool" aria-label="附加檔案">
            <Plus size={18} strokeWidth={2} />
          </button>
          <button className="h-tool" aria-label="語音">
            <Mic {...icon} />
          </button>
          <input placeholder="和 Yuki 說點什麼…" aria-label="和 Yuki 說點什麼" />
          <button className="h-send" aria-label="送出">
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
        </div>
      }
    >
      <div className="h-thread">
        <div className="h-date">10月24日 上午 08:00</div>
        <Message own text="幫我整理一下這週的訪談筆記。" />
        <div className="h-card">
          <div>
            <b>整理訪談筆記</b>
            <span className="h-status" data-text="body">
              <span className="h-dot" />
              已完成 · 3 個步驟
            </span>
          </div>
          <button className="h-button">查看詳情</button>
        </div>
        <Message meta="Yuki" text="我先按主題分組，原始筆記和摘要會一起留著。" />
        <Message own text="好，請把值得回訪的問題另外標出來。" />
        <Message meta="Yuki" text="已經標出三個可以追問的問題。原始訪談的來源也保留在各段下方。" />
      </div>
    </Window>
  )
}

function Pairing() {
  return (
    <Window
      toolbar={
        <>
          <Lights />
          <div className="h-title" />
        </>
      }
    >
      <div className="h-onboard">
        <div className="h-mark">
          <MessageCircle size={28} strokeWidth={2} />
        </div>
        <h1>連接已有 Yuki</h1>
        <p data-text="body">貼上配對連結或收到的完整配對資訊。</p>
        <section className="h-form-section">
          <div className="h-form" style={{ padding: 12 }}>
            <label htmlFor="pair" style={{ font: 'var(--t-headline)' }}>
              配對連結、綁定碼或完整回覆
            </label>
            <div className="h-field-row">
              <input id="pair" className="h-field" data-focus="" placeholder="yuki://pair?…" />
              <button className="h-button" data-size="large">
                <Clipboard size={14} strokeWidth={2} />
                貼上
              </button>
            </div>
          </div>
          <p className="h-note" data-text="body">
            從已連接的 Yuki 取得配對資訊；綁定碼只可使用一次。
          </p>
        </section>
        <section className="h-form-section">
          <h3>其他連接方式</h3>
          <div className="h-form">
            {[
              [Terminal, '通過 SSH 連接', '伺服器沒有公開網址時使用，不必另外建立通道'] as const,
              [Network, '透過 Tailscale 連接', '先接上同一個 Tailnet'] as const,
              [PenLine, '手動輸入伺服器位址', '沒有配對連結時使用'] as const,
            ].map(([Icon, title, note]) => (
              <div key={title} className="h-form-row" style={{ padding: 0 }}>
                <button className="h-link-row">
                  <Icon {...icon} />
                  <span>
                    <span data-text="body">{title}</span>
                    <small data-text="body">{note}</small>
                  </span>
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          <p className="h-note" data-text="body">
            <Link size={11} strokeWidth={2} style={{ verticalAlign: -1, marginRight: 4 }} />
            使用可從這台電腦存取的 Yuki 網址；使用 VPN 時請先接上該網路。
          </p>
        </section>
        <div className="h-actions">
          <button className="h-button" data-size="large">
            返回
          </button>
          <button className="h-button" data-size="large" data-style="prominent" disabled>
            繼續
          </button>
        </div>
      </div>
    </Window>
  )
}

function Tokens() {
  const styles = [
    ['Large Title', '--t-large-title', '26/32'],
    ['Title 1', '--t-title1', '22/28'],
    ['Title 2', '--t-title2', '17/22'],
    ['Title 3', '--t-title3', '15/20'],
    ['Headline', '--t-headline', '13/18'],
    ['Body', '--t-body', '13/18'],
    ['Callout', '--t-callout', '12/16'],
    ['Subheadline', '--t-subheadline', '11/14'],
  ]
  return (
    <div className="h-spec" data-testid="prototype">
      <section>
        <h2>字級（macOS 內建文字樣式，中文行高略增）</h2>
        {styles.map(([name, token, size]) => (
          <div key={name} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
            <span style={{ width: 150, color: 'var(--label-2)', font: 'var(--t-callout)' }}>
              {name} {size}
            </span>
            <span style={{ font: `var(${token})` }}>連接已有 Yuki — Settings 設定</span>
          </div>
        ))}
      </section>
      <section>
        <h2>標籤與填色（alpha 疊在底色上）</h2>
        <div className="h-spec-grid">
          {[
            'label',
            'label-2',
            'label-3',
            'separator',
            'fill-1',
            'fill-2',
            'fill-3',
            'grouped',
            'accent-fill',
            'accent-text',
          ].map((name) => (
            <span key={name} className="h-chip">
              <i style={{ background: `var(--${name})` }} />
              {name}
            </span>
          ))}
        </div>
      </section>
      <section>
        <h2>控制尺寸：regular 圓角矩形，large / XL 膠囊</h2>
        <div className="h-spec-grid">
          <button className="h-button">regular 24</button>
          <span className="h-popup">彈出選單 24</span>
          <span className="h-segmented">
            <span data-on="">一</span>
            <span>二</span>
          </span>
          <button className="h-button" data-size="large">
            large 28
          </button>
          <button className="h-button" data-size="large" data-style="prominent">
            主要 28
          </button>
          <button className="h-button" data-size="xl" data-style="prominent">
            XL 36
          </button>
          <span className="h-switch" data-on="" />
        </div>
      </section>
      <section>
        <h2>同心圓角：內層半徑 = 外層半徑 − 間距</h2>
        <div
          style={{
            width: 360,
            height: 180,
            borderRadius: 'var(--r-window)',
            background: 'var(--fill-3)',
            padding: 'var(--inset)',
            boxShadow: 'inset 0 0 0 0.5px var(--separator)',
          }}
        >
          <div
            className="h-glass"
            style={{
              width: 180,
              height: '100%',
              borderRadius: 'var(--r-pane)',
              padding: 8,
              font: 'var(--t-callout)',
            }}
          >
            window 20 − inset 8 = pane 12
          </div>
        </div>
      </section>
    </div>
  )
}

// Response (s) and bounce of a {k, damping} spring with unit mass: k = (2π / response)²,
// damping ratio = 1 − bounce (SwiftUI's mapping for bounce ≥ 0).
const fromSwiftUI = (duration: number, bounce: number): SpringConfig => ({
  k: ((2 * Math.PI) / duration) ** 2,
  damping: 1 - bounce,
})
const response = (config: SpringConfig) => (2 * Math.PI) / Math.sqrt(config.k)

function Motion() {
  const references = [
    ['.smooth', fromSwiftUI(0.5, 0)],
    ['.snappy', fromSwiftUI(0.5, 0.15)],
    ['.bouncy', fromSwiftUI(0.5, 0.3)],
  ] as const
  const ours = [
    ['select', springs.select, '#2a78d6'],
    ['toggle', springs.toggle, '#eb6834'],
    ['bubble', springs.bubble, '#1baf7a'],
    ['pressUp', springs.pressUp, '#eda100'],
  ] as const
  const width = 760,
    height = 320,
    pad = { left: 44, right: 120, top: 16, bottom: 36 },
    seconds = 0.9,
    top = 1.4
  const x = (t: number) => pad.left + (t / seconds) * (width - pad.left - pad.right)
  const y = (v: number) => pad.top + (1 - v / top) * (height - pad.top - pad.bottom)
  const path = (config: SpringConfig) =>
    sampleSpring(config)
      .slice(0, Math.round(seconds * 60) + 1)
      .map((sample, index) => `${index ? 'L' : 'M'}${x(index / 60)},${y(sample.value)}`)
      .join('')
  // Each reference is named where the three are furthest apart, so a label sits on its own curve.
  const labelAt = 0.3
  const at = (config: SpringConfig, t: number) => sampleSpring(config)[Math.round(t * 60)]!.value
  const rows = Object.entries(springs).map(([name, config]) => ({
    name,
    response: response(config),
    bounce: Math.max(0, 1 - config.damping),
  }))
  return (
    <div className="h-spec" data-testid="prototype">
      <section>
        <h2>彈簧階躍響應：Yuki（彩色）與 SwiftUI 預設（灰虛線）</h2>
        <svg className="h-chart" width={width} height={height} role="img" aria-label="彈簧曲線">
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(v)}
                y2={y(v)}
                stroke="var(--separator)"
              />
              <text x={pad.left - 8} y={y(v) + 4} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75].map((t) => (
            <text key={t} x={x(t)} y={height - 12} textAnchor="middle">
              {t}s
            </text>
          ))}
          {references.map(([name, config]) => (
            <g key={name}>
              <path
                d={path(config)}
                fill="none"
                stroke="var(--label-3)"
                strokeWidth={2}
                strokeDasharray="5 4"
              />
              <text x={x(labelAt) + 4} y={y(at(config, labelAt)) + 12}>
                {name}
              </text>
            </g>
          ))}
          {ours.map(([name, config, color]) => (
            <path key={name} d={path(config)} fill="none" stroke={color} strokeWidth={2} />
          ))}
        </svg>
        <div className="h-spec-grid" style={{ marginTop: 8 }}>
          {ours.map(([name, , color]) => (
            <span key={name} className="h-status">
              <span className="h-dot" style={{ background: color }} />
              {name}
            </span>
          ))}
          <span className="h-status">灰虛線：SwiftUI .smooth / .snappy / .bouncy（0.5s）</span>
        </div>
      </section>
      <section>
        <h2>spring.ts 換算</h2>
        <table style={{ borderCollapse: 'collapse', font: 'var(--t-callout)' }}>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td style={{ padding: '2px 16px 2px 0' }}>{row.name}</td>
                <td style={{ padding: '2px 16px 2px 0' }}>response {row.response.toFixed(3)}s</td>
                <td>bounce {row.bounce.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

const pages: Record<string, () => ReactNode> = {
  settings: Settings,
  look: Settings,
  chat: Chat,
  pairing: Pairing,
  tokens: Tokens,
  motion: Motion,
}
const Page = pages[page] ?? Settings
createRoot(document.getElementById('root')!).render(<Page />)
