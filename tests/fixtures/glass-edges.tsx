import { useLayoutEffect, type CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { useGlass, type GlassKind } from '../../src/renderer/materials/glass'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'

/*
 * The app's own glass (glass.ts, materials.css) laid over a known background, for close-ups of
 * its edges: `scene=set` shows the panes and controls the app draws, at their own sizes, over
 * `bg` (grid, lineart or text); `scene=frame` lays one glass of `kind` at a given place and radius
 * over a picture (`img`), the geometry of a reference frame.
 */
const query = new URLSearchParams(location.search)
const theme = query.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.theme = theme

interface Item {
  kind: GlassKind
  name: string
  x: number
  y: number
  width: number
  height: number
  radius: number
  tint: string
}
const tint = (text: boolean) => (text ? 'var(--mat-pane)' : 'var(--mat-glass)')
const set: Item[] = [
  {
    kind: 'toolbar',
    name: 'button',
    x: 40,
    y: 40,
    width: 72,
    height: 28,
    radius: 14,
    tint: tint(false),
  },
  {
    kind: 'toolbar',
    name: 'toolbar',
    x: 140,
    y: 37,
    width: 104,
    height: 34,
    radius: 17,
    tint: tint(false),
  },
  {
    kind: 'composer',
    name: 'composer',
    x: 280,
    y: 32,
    width: 480,
    height: 44,
    radius: 22,
    tint: tint(true),
  },
  {
    kind: 'card',
    name: 'card',
    x: 40,
    y: 120,
    width: 320,
    height: 200,
    radius: 28,
    tint: tint(true),
  },
  {
    kind: 'sheet',
    name: 'sheet',
    x: 400,
    y: 120,
    width: 360,
    height: 200,
    radius: 22,
    tint: 'var(--mat-sheet-glass)',
  },
  {
    kind: 'toggle',
    name: 'toggle',
    x: 40,
    y: 360,
    width: 18,
    height: 18,
    radius: 9,
    tint: 'rgb(255 255 255 / 0.5)',
  },
  {
    kind: 'segment',
    name: 'segment',
    x: 100,
    y: 356,
    width: 72,
    height: 26,
    radius: 13,
    tint: 'rgb(255 255 255 / 0.4)',
  },
  {
    kind: 'slider',
    name: 'slider',
    x: 220,
    y: 352,
    width: 37,
    height: 33,
    radius: 16.5,
    tint: 'rgb(0 0 0 / 0.05)',
  },
  {
    kind: 'card',
    name: 'folder',
    x: 300,
    y: 350,
    width: 128,
    height: 128,
    radius: 30,
    tint: tint(true),
  },
]

function Glass({ item }: { item: Item }) {
  const dynamic = item.kind === 'toggle' || item.kind === 'segment' || item.kind === 'slider'
  const glass = useGlass<HTMLDivElement>(item.kind, dynamic)
  useLayoutEffect(() => {
    if (dynamic) glass.setStrength(1)
  })
  const filter =
    item.kind === 'sheet'
      ? 'var(--glass-sheet)'
      : dynamic
        ? 'var(--glass-lens)'
        : 'var(--glass-regular)'
  const style: CSSProperties = {
    position: 'absolute',
    left: item.x,
    top: item.y,
    width: item.width,
    height: item.height,
    borderRadius: item.radius,
    background: item.tint,
    backdropFilter: query.get('filter') ?? filter,
    // The shadows the app's panes carry, with the hairline the light theme draws around them.
    boxShadow: dynamic
      ? undefined
      : item.kind === 'sheet'
        ? 'var(--shadow-pane)'
        : 'var(--shadow-glass)',
  }
  return <div ref={glass.ref} data-glass={item.kind} data-name={item.name} style={style} />
}

function background(kind: string): CSSProperties {
  if (kind === 'grid')
    return {
      background:
        'repeating-linear-gradient(0deg, #222 0 1px, transparent 1px 12px), repeating-linear-gradient(90deg, #222 0 1px, transparent 1px 12px), #f4f4f4',
    }
  if (kind === 'white') return { background: '#ffffff' }
  if (kind === 'dark') return { background: '#15161a' }
  if (kind === 'gray') return { background: '#808080' }
  if (kind === 'pale') return { background: '#d8d8d8' }
  // Saturated colour: blue on the left half, orange on the right.
  if (kind === 'duo') return { background: 'linear-gradient(90deg, #2f6bff 50%, #ff8a1f 50%)' }
  // Orange above y = 40, blue below: the composer's top edge (y = 32) lies on orange, its inside
  // on blue.
  if (kind === 'band') return { background: 'linear-gradient(180deg, #ff8a1f 40px, #2f6bff 40px)' }
  // A ramp from dark to light down the first 120px: depth inside the composer reads as brightness.
  if (kind === 'ramp')
    return { background: 'linear-gradient(180deg, #101010 0px, #f0f0f0 120px, #f0f0f0)' }
  return { background: `url(${query.get('img')}) center / cover` }
}

function Text() {
  // Lines of text and hairlines, as content passing under a toolbar.
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        padding: 20,
        font: '13px/18px var(--font-ui)',
        color: theme === 'dark' ? '#eee' : '#111',
        overflow: 'hidden',
      }}
    >
      {Array.from({ length: 40 }, (_, index) => (
        <p key={index} style={{ margin: '0 0 6px', borderBottom: '1px solid currentColor' }}>
          Liquid Glass 的邊緣把後面的文字彎過去 — The edge bends what lies beneath. 0123456789
        </p>
      ))}
    </div>
  )
}

function App() {
  const scene = query.get('scene') ?? 'set',
    bg = query.get('bg') ?? 'grid'
  const items: Item[] =
    scene === 'frame'
      ? [
          {
            kind: (query.get('kind') ?? 'toggle') as GlassKind,
            name: 'frame',
            x: Number(query.get('x')),
            y: Number(query.get('y')),
            width: Number(query.get('w')),
            height: Number(query.get('h')),
            radius: Number(query.get('r')),
            tint: query.get('tint') ?? 'transparent',
          },
        ]
      : set
  return (
    // `shift` moves the scene up, for a frame taller than the screen.
    <div
      style={{
        position: 'fixed',
        inset: 0,
        bottom: 'auto',
        height: `calc(100vh + ${Number(query.get('shift') ?? 0)}px)`,
        translate: `0 ${-Number(query.get('shift') ?? 0)}px`,
        ...background(bg),
      }}
    >
      {bg === 'text' && <Text />}
      {items.map((item) => (
        <Glass key={item.name} item={item} />
      ))}
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
setTimeout(() => (document.documentElement.dataset.ready = 'true'), 1200)
