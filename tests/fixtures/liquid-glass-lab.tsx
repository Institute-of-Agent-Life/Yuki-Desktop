/*
 * Research prototype only (液态玻璃质感调研, 2026-11-23): not part of the app, served by the
 * fixture server (tests/fixtures/vite.config.ts) at /liquid-glass-lab.html.
 *   ?v=all                       the current glass and the three v2 proposals side by side
 *   ?v=all&set=v1                the current glass and the three rejected v1 proposals
 *   ?v=<variant>&solo=1          one variant filling the window (&animate=1 scrolls the content)
 *   &bg=chat|text|photo          what lies beneath (&img=<url> replaces the photo)
 *   &theme=dark                  dark appearance
 *   ?page=profile                bevel profiles and displacement maps, drawn
 *   ?page=slider                 the iOS-style transparency slider with its live preview
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { Droplet, Plus, Mic, Search, Sparkles, SunMedium } from 'lucide-react'
import { useGlass, type GlassKind } from '../../src/renderer/materials/glass'
import { useSprings, capturePointer } from '../../src/renderer/motion/hooks'
import { clamp, rubber, springs } from '../../src/renderer/motion/spring'
import { Slider } from '../../src/renderer/components/Controls'
import { buildLabFilter, labMaps, type LabKind, type Variant } from './liquid-glass-lens'
import {
  bevelBend,
  bevelHeight,
  bevelOf,
  slabFilter,
  slabs,
  slabMaps,
  type SlabVariant,
} from './liquid-glass-slab'
import '../../src/renderer/tokens.css'
import '../../src/renderer/materials/materials.css'
import './liquid-glass-lab.css'

const query = new URLSearchParams(location.search)
document.documentElement.dataset.theme = query.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.dataset.backdrop = 'aurora'
type Shown = 'current' | Variant | SlabVariant
const allVariants: { id: Shown; name: string; note: string }[] = [
  { id: 'current', name: 'A 現狀', note: '圓弧邊折射 + 細高光線' },
  { id: 'slab-thin', name: 'S1 薄倒角', note: '平板 + 8px 圓弧倒角' },
  { id: 'slab', name: 'S2 標準倒角', note: '平板 + 12px 倒角 + 輕色散' },
  { id: 'slab-thick', name: 'S3 厚倒角', note: '平板 + 16px 倒角' },
  { id: 'v3', name: 'V3 對齊蘋果', note: '按 HIG 實測：模糊 + 提亮 + 邊緣細光' },
  { id: 'curved', name: 'v1-B 曲面透鏡', note: '已否決：整面鼓起' },
  { id: 'volume', name: 'v1-C 體積光影', note: '已否決：枕形明暗' },
  { id: 'lit', name: 'v1-D 即時光照', note: '已否決：無 GPU 時 30fps' },
]
const variants = allVariants.filter((item) =>
  query.get('set') === 'v1'
    ? ['current', 'curved', 'volume', 'lit'].includes(item.id)
    : query.get('set') === 'v3'
      ? ['current', 'slab', 'v3'].includes(item.id)
      : ['current', 'slab-thin', 'slab', 'slab-thick'].includes(item.id),
)
const isSlab = (variant: Shown): variant is SlabVariant =>
  variant.startsWith('slab') || variant === 'v3'
// While tuning v3: ?p={"blur":4,...} overrides its material and light (see liquid-glass-slab.ts).
const tuning = JSON.parse(query.get('p') ?? '{}') as Record<string, number | string>
Object.assign(globalThis, { __v3: tuning })
for (const [key, value] of Object.entries(tuning))
  if (['blur', 'bright', 'sat', 'contrast', 'tint', 'outline', 'shadow'].includes(key))
    document.documentElement.style.setProperty(
      `--v3-${key}`,
      typeof value === 'number' && key === 'blur' ? `${value}px` : String(value),
    )
const ready = { count: 0 }

// Patterned content under the glass, so bending and light have something to show.
function Scene({ animate, children }: { animate: boolean; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!animate) return
    let frame = 0
    const start = performance.now()
    const step = (now: number) => {
      const offset = ((now - start) / 12) % 480
      content.current!.style.transform = `translateY(${-offset}px)`
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [animate])
  const rows = Array.from({ length: 18 }, (_, index) => index),
    background = query.get('bg') ?? 'chat'
  if (background === 'text')
    return (
      <div className="scene text">
        <div className="content" ref={content}>
          {Array.from({ length: 6 }, (_, index) => (
            <p key={index}>
              玻璃應該是一塊略厚的平板：中間大面積是平的，透過去看內容基本不變形；只有靠近邊緣的一圈倒角，光線沿圓角彎折並出現高光。
              The quick brown fox jumps over the lazy dog — 0123456789. Liquid Glass keeps text
              legible through its face and bends it only at the bevel.
              這段文字用來檢查中心是否完全不變形， 以及邊緣倒角的彎折是否克制。
            </p>
          ))}
        </div>
        {children}
      </div>
    )
  if (background === 'photo')
    return (
      <div className="scene photo">
        <div className="content" ref={content}>
          <img src={query.get('img') ?? './liquid-glass-photo.svg'} alt="" />
          <img src={query.get('img') ?? './liquid-glass-photo.svg'} alt="" />
        </div>
        {children}
      </div>
    )
  return (
    <div className="scene">
      <div className="content" ref={content}>
        {rows.map((index) => (
          <div key={index} className={`row ${index % 3 === 1 ? 'mine' : ''}`}>
            {index % 4 === 2 ? (
              <img src="./picture.svg" alt="" />
            ) : (
              <p>
                {
                  [
                    '幫我整理一下這週的訪談筆記，重點放在使用者對新版工作流程的回饋。',
                    'Liquid Glass bends light at its edges, so the content beneath stays legible.',
                    '好的，我先把三場訪談的逐字稿對齊，再標出重複出現的痛點。',
                    '玻璃的邊緣應該像有厚度一樣把後面的文字彎過去。',
                  ][index % 4]
                }
              </p>
            )}
          </div>
        ))}
        <div className="stripes" />
      </div>
      {/* Sharp edges right under the glass: stripes beneath the composer, text beneath the button. */}
      <div className="probe stripesProbe" style={animate ? { display: 'none' } : undefined} />
      <p className="probe textProbe" style={animate ? { display: 'none' } : undefined}>
        Aa 玻璃
      </p>
      {children}
    </div>
  )
}

const radii: Record<LabKind, number> = {
  toolbar: 20,
  button: 26,
  composer: 26,
  card: 24,
  // The disc page places a shape of any size: ?w=&h=&x=&y=&r= (CSS px).
  disc: Number(query.get('r') ?? 78.5),
}
const currentKind: Record<LabKind, GlassKind> = {
  toolbar: 'toolbar',
  button: 'toolbar',
  composer: 'composer',
  card: 'card',
  disc: 'composer',
}
function CurrentGlass({ kind, className, children }: GlassProps) {
  const glass = useGlass<HTMLDivElement>(currentKind[kind])
  useLayoutEffect(() => {
    ready.count++
  }, [])
  return (
    <div
      ref={glass.ref}
      data-glass={currentKind[kind]}
      data-lab-kind={kind}
      className={`glass current ${className}`}
    >
      {children}
    </div>
  )
}
interface GlassProps {
  kind: LabKind
  className: string
  children?: ReactNode
  style?: CSSProperties
}
function LabGlass({ kind, className, children, variant }: GlassProps & { variant: Variant }) {
  const ref = useRef<HTMLDivElement>(null),
    rim = useRef<HTMLSpanElement>(null),
    shade = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const width = element.offsetWidth,
      height = element.offsetHeight,
      scale = Math.min(3, Math.max(1, Math.ceil(devicePixelRatio)))
    const maps = labMaps(width, height, radii[kind], kind, scale, variant)
    const filter = buildLabFilter(element, kind, variant, maps, width, height)
    const pane = kind === 'card'
    element.style.backdropFilter = pane
      ? `blur(24px) saturate(160%) var(--glass-calm) url(#${filter.id})`
      : `url(#${filter.id}) blur(1px) saturate(${variant === 'curved' ? 116 : 150}%) var(--glass-calm)`
    for (const [layer, map] of [
      [rim, maps.rim],
      [shade, maps.shade],
    ] as const)
      layer.current!.style.setProperty(
        '-webkit-mask-box-image',
        `url("${map}") ${maps.slice} fill / ${maps.border}`,
      )
    const move = (event: PointerEvent) => filter.point(event.clientX, event.clientY)
    if (variant === 'lit') addEventListener('pointermove', move, { passive: true })
    element.dataset.ready = 'true'
    ready.count++
    return () => {
      removeEventListener('pointermove', move)
      filter.dispose()
    }
  }, [kind, variant])
  return (
    <div ref={ref} data-lab-kind={kind} className={`glass ${variant} ${className}`}>
      {variant !== 'curved' && <span ref={shade} className="shade" aria-hidden="true" />}
      {variant === 'curved' && <span ref={shade} hidden />}
      <span ref={rim} className="rim" aria-hidden="true" />
      {children}
    </div>
  )
}
function SlabGlass({
  kind,
  className,
  children,
  variant,
  style,
}: GlassProps & { variant: SlabVariant }) {
  const ref = useRef<HTMLDivElement>(null),
    rim = useRef<HTMLSpanElement>(null),
    shade = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = ref.current!
    const width = element.offsetWidth,
      height = element.offsetHeight,
      scale = Math.min(3, Math.max(1, Math.ceil(devicePixelRatio)))
    const maps = slabMaps(width, height, radii[kind], variant, scale)
    const filter = slabFilter(variant, maps, width, height)
    // The face keeps today's tint, frost and blur: only the bevel is new. v3 takes Apple's
    // measured material instead: a moderate blur, a lift in brightness, a little saturation.
    element.style.backdropFilter =
      variant === 'v3'
        ? `url(#${filter.id}) blur(var(--v3-blur)) brightness(var(--v3-bright)) saturate(var(--v3-sat)) contrast(var(--v3-contrast))`
        : kind === 'card'
          ? `blur(24px) saturate(160%) var(--glass-calm) url(#${filter.id})`
          : `url(#${filter.id}) blur(1px) saturate(116%) var(--glass-calm)`
    for (const [layer, map] of [
      [rim, maps.rim],
      [shade, maps.shade],
    ] as const)
      layer.current!.style.setProperty(
        '-webkit-mask-box-image',
        `url("${map}") ${maps.slice} fill / ${maps.border}`,
      )
    element.dataset.bevel = String(maps.bevel)
    element.dataset.ready = 'true'
    ready.count++
    return filter.dispose
  }, [kind, variant])
  return (
    <div
      ref={ref}
      data-lab-kind={kind}
      className={`glass slabGlass ${variant === 'v3' ? 'v3Glass' : ''} ${className}`}
      style={style}
    >
      <span ref={shade} className="slabShade" aria-hidden="true" />
      <span ref={rim} className="rim" aria-hidden="true" />
      {children}
    </div>
  )
}
function Glass(props: GlassProps & { variant: Shown }) {
  const { variant } = props
  if (variant === 'current') return <CurrentGlass {...props} />
  if (isSlab(variant)) return <SlabGlass {...props} variant={variant} />
  return <LabGlass {...props} variant={variant} />
}

function Panel({ variant, solo }: { variant: Shown; solo: boolean }) {
  const meta = allVariants.find((item) => item.id === variant)!
  return (
    <section className={`panel ${solo ? 'solo' : ''}`} data-variant={variant}>
      <Scene animate={query.get('animate') === '1'}>
        <header className="label">
          <strong>{meta.name}</strong>
          <span>{meta.note}</span>
        </header>
        <Glass variant={variant} kind="toolbar" className="toolbar">
          <Search size={17} />
          <Sparkles size={17} />
          <SunMedium size={17} />
        </Glass>
        <Glass variant={variant} kind="button" className="button">
          <Plus size={22} />
        </Glass>
        <Glass variant={variant} kind="card" className="card">
          <strong>今日摘要</strong>
          <span>三場訪談已整理，兩項待確認。</span>
        </Glass>
        <Glass variant={variant} kind="composer" className="composer">
          <span>傳訊息給 Yuki…</span>
          <Mic size={18} />
        </Glass>
      </Scene>
    </section>
  )
}

function Comparison() {
  const solo = query.get('solo') === '1',
    shown = (query.get('v') ?? 'all') as Shown | 'all' | 'none'
  useLayoutEffect(() => {
    document.documentElement.dataset.labReady = 'true'
  }, [])
  if (shown === 'none')
    return (
      <main className="grid solo">
        <section className="panel solo">
          <Scene animate={query.get('animate') === '1'}>
            <header className="label">
              <strong>無玻璃</strong>
              <span>基準</span>
            </header>
          </Scene>
        </section>
      </main>
    )
  return (
    <main className={`grid ${solo ? 'solo' : ''}`}>
      {(shown === 'all' ? variants.map((item) => item.id) : [shown]).map((id) => (
        <Panel key={id} variant={id} solo={solo} />
      ))}
    </main>
  )
}

/*
 * iOS-style slider, as in Control Center: a thick capsule whose fill is the value, no knob. Held,
 * it swells; pulled past either end it stretches that way and thins, and springs back on release.
 */
export function GlassSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange(value: number): void
}) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef(value),
    latest = useRef(onChange)
  latest.current = onChange
  const { values, wake } = useSprings({ press: 0, over: 0 }, (s, reduced) => {
    const element = host.current
    if (!element) return
    const press = reduced ? 0 : s.press.value,
      over = reduced ? 0 : s.over.value,
      width = element.offsetWidth
    element.style.setProperty('--fill', `${current.current}%`)
    element.style.setProperty('--press', String(press))
    // Stretch toward the pull, anchored at the far end; thin as it stretches.
    element.style.transformOrigin = over < 0 ? 'right center' : 'left center'
    element.style.transform = `scale(${1 + 0.035 * press + Math.abs(over) / width}, ${1 + 0.16 * press - (Math.abs(over) / width) * 1.6})`
  })
  useLayoutEffect(() => {
    current.current = value
    host.current?.style.setProperty('--fill', `${value}%`)
    wake()
  }, [value])
  const set = (next: number) => {
    current.current = Math.round(clamp(next, 0, 100))
    host.current!.setAttribute('aria-valuenow', String(current.current))
    latest.current(current.current)
    wake()
  }
  return (
    <div
      ref={host}
      className="iosSlider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      onKeyDown={(event) => {
        const step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5 }[event.key]
        if (step === undefined) return
        event.preventDefault()
        set(current.current + step)
        values.press.snap(0.5)
        values.press.aim(0, springs.thumb)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        values.press.aim(1, springs.thumb)
        // Relative drag, as on iOS: grabbing anywhere does not jump the value.
        const bounds = event.currentTarget.getBoundingClientRect(),
          origin = event.clientX,
          from = current.current
        const update = (move: PointerEvent) => {
          const raw = from + ((move.clientX - origin) / bounds.width) * 100
          set(raw)
          values.over.snap(
            raw < 0
              ? -rubber(-raw * (bounds.width / 100), 16, 90)
              : raw > 100
                ? rubber((raw - 100) * (bounds.width / 100), 16, 90)
                : 0,
          )
          wake()
        }
        capturePointer(event.currentTarget, event.nativeEvent, update, () => {
          values.press.aim(0, springs.thumb)
          values.over.aim(0, { k: 420, damping: 0.5 })
          wake()
        })
        wake()
      }}
    >
      <Droplet className="iosIcon" size={18} />
      {/* The icon again inside the fill, white, so it turns white exactly where the fill covers it. */}
      <span className="iosFill">
        <Droplet className="iosIcon" size={18} />
      </span>
    </div>
  )
}

// A small window over a desktop picture: what the transparency slider changes, live.
function Preview({ transparency }: { transparency: number }) {
  const clear = transparency / 100
  return (
    <div className="desk" style={{ '--clear': clear } as CSSProperties}>
      <div className="wallpaper" />
      <div className={`window ${transparency === 0 ? 'opaque' : ''}`}>
        <aside>
          <i />
          <i />
          <i />
        </aside>
        <div className="page">
          <p className="bubble">今天的訪談整理好了嗎？</p>
          <p className="bubble mine">整理好了，三場都在這裡。</p>
          <div className="miniComposer">傳訊息…</div>
        </div>
      </div>
    </div>
  )
}

function SliderPage() {
  const [transparency, setTransparency] = useState(80),
    [current, setCurrent] = useState(145)
  useLayoutEffect(() => {
    document.documentElement.dataset.labReady = 'true'
  }, [])
  return (
    <main className="sliderPage">
      <section className="settingsRow" data-testid="slider-demo">
        <div className="settingsText">
          <strong>透明度</strong>
          <span>向左更實，向右更透；拖到最左即不透明。</span>
          <GlassSlider label="透明度" value={transparency} onChange={setTransparency} />
          <output data-testid="transparency-value">
            {transparency === 0 ? '不透明' : `${transparency}%`}
          </output>
          <div className="reference">
            <span>對照：現有 Slider（細軌道 + 玻璃滑塊）</span>
            <Slider label="現有滑塊" value={current} onChange={setCurrent} />
          </div>
        </div>
        <Preview transparency={transparency} />
      </section>
    </main>
  )
}

/*
 * The shapes behind the glass, drawn: a cross-section through a 52px pane (the composer, and the
 * round button) from one edge to the other, its surface height and how far each point's view is
 * displaced; then the displacement maps themselves.
 */
const series = [
  { id: 'current', label: 'A 現狀', color: '#2a78d6' },
  { id: 'curved', label: 'v1-B', color: '#eb6834' },
  { id: 'slab-thin', label: 'S1 薄', color: '#1baf7a' },
  { id: 'slab', label: 'S2 標準', color: '#eda100' },
  { id: 'slab-thick', label: 'S3 厚', color: '#e87ba4' },
] as const
// v1-B's surface and bend, as liquid-glass-lens.ts paints them (squircle, Snell, magnified).
const squircle = (t: number) => Math.pow(1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4), 0.25)
const v1Slope = (t: number) => {
  const u = Math.min(1, Math.max(0.002, t))
  return Math.min(8, Math.pow(1 - u, 3) * Math.pow(1 - Math.pow(1 - u, 4), -0.75))
}
const v1Shift = (t: number) => {
  const theta = Math.atan(v1Slope(t))
  return Math.tan(theta - Math.asin(Math.sin(theta) / 1.5)) * (0.3 + squircle(t))
}
const v1Peak = Math.max(...Array.from({ length: 200 }, (_, index) => v1Shift(index / 200)))
const circleArc = (t: number) => (t >= 1 ? 1 : Math.sqrt(1 - (1 - Math.max(0, t)) ** 2))
// [height 0–1, displacement px] at `position` px across a section `size` px wide.
function section(id: string, kind: 'composer' | 'button', position: number, size = 52) {
  const inset = Math.min(position, size - position),
    fromCentre = (position - size / 2) / (size / 2)
  if (id === 'current') {
    // glass.ts: composer [bezel 16, bend 18]; the lab's button is a toolbar glass [10, 12].
    const [bezel, bend] = kind === 'composer' ? [16, 18] : [10, 12]
    const edge = Math.max(0, 1 - inset / bezel)
    return [circleArc(inset / bezel), bend * (1 - Math.sqrt(Math.max(0, 1 - edge ** 2)))]
  }
  if (id === 'curved') {
    const [bezel, bend, zoom] = kind === 'composer' ? [22, 26, 0] : [20, 16, 0.16]
    const t = inset / bezel
    const edge = t < 1 ? v1Shift(t) / v1Peak : 0
    return [squircle(t), bend * Math.min(1, edge + zoom * Math.abs(fromCentre))]
  }
  const variant = id as SlabVariant,
    bevel = bevelOf(variant, kind === 'composer' ? 600 : 52, 52, 26)
  const t = inset / bevel
  return [bevelHeight(t), slabs[variant].bend * bevelBend(t)]
}

function Chart({
  title,
  kind,
  measure,
  unit,
  max,
}: {
  title: string
  kind: 'composer' | 'button'
  measure: 0 | 1
  unit: string
  max: number
}) {
  const width = 520,
    height = 210,
    left = 44,
    right = 96,
    top = 14,
    bottom = 34
  const x = (position: number) => left + (position / 52) * (width - left - right),
    y = (value: number) => top + (1 - value / max) * (height - top - bottom)
  const ticks = [0, max / 2, max]
  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      <svg width={width} height={height} role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="gridLine" />
            <text x={left - 6} y={y(tick) + 4} textAnchor="end" className="tick">
              {Number(tick.toFixed(2))}
            </text>
          </g>
        ))}
        {[0, 13, 26, 39, 52].map((tick) => (
          <text
            key={tick}
            x={x(tick)}
            y={height - bottom + 16}
            textAnchor="middle"
            className="tick"
          >
            {tick}
          </text>
        ))}
        <text x={(left + width - right) / 2} y={height - 4} textAnchor="middle" className="tick">
          橫截面位置（px，0 與 52 是兩側邊緣）· 縱軸：{unit}
        </text>
        {series.map((item, index) => {
          const points = Array.from({ length: 209 }, (_, step) => {
            const position = step / 4
            return `${x(position).toFixed(1)},${y(section(item.id, kind, position)[measure]!).toFixed(1)}`
          })
          const labelY = top + 12 + index * 17
          return (
            <g key={item.id}>
              <polyline points={points.join(' ')} fill="none" stroke={item.color} strokeWidth={2} />
              <line
                x1={width - right + 10}
                x2={width - right + 24}
                y1={labelY - 4}
                y2={labelY - 4}
                stroke={item.color}
                strokeWidth={2}
              />
              <text x={width - right + 28} y={labelY} className="legend">
                {item.label}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

// A displacement map as painted, and its strength amplified: white where the view moves most.
function MapView({ label, href }: { label: string; href: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    if (!href) return
    const image = new Image()
    image.src = href
    void image.decode().then(() => {
      const target = canvas.current!
      target.width = image.width
      target.height = image.height
      const context = target.getContext('2d')!
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, image.width, image.height)
      for (let k = 0; k < data.data.length; k += 4) {
        const strength = Math.hypot(data.data[k]! - 128, data.data[k + 1]! - 128) / 127
        data.data[k] =
          data.data[k + 1] =
          data.data[k + 2] =
            Math.round(Math.min(1, strength * 1.6) * 255)
        data.data[k + 3] = 255
      }
      context.putImageData(data, 0, 0)
    })
  }, [href])
  return (
    <figure className="mapView">
      <figcaption>{label}</figcaption>
      {href && <img src={href} alt="" />}
      <canvas ref={canvas} />
    </figure>
  )
}

function ProfilePage() {
  const composer = useRef<HTMLDivElement>(null),
    button = useRef<HTMLDivElement>(null)
  const [maps, setMaps] = useState<Record<string, string>>({})
  useLayoutEffect(() => {
    const scale = Math.min(3, Math.max(1, Math.ceil(devicePixelRatio)))
    // Today's maps, read back from the filters the current glass built.
    const current = (element: HTMLElement) =>
      document
        .getElementById(
          /url\("?#([^")]+)/.exec(element.style.getPropertyValue('--refract'))?.[1] ?? '',
        )
        ?.querySelector('feImage')
        ?.getAttribute('href') ?? ''
    const read = () =>
      setMaps({
        currentComposer: current(composer.current!),
        currentButton: current(button.current!),
        v1Composer: labMaps(600, 52, 26, 'composer', scale, 'curved').displacement,
        v1Button: labMaps(52, 52, 26, 'button', scale, 'curved').displacement,
        slabComposer: slabMaps(600, 52, 26, 'slab', scale).displacement,
        slabButton: slabMaps(52, 52, 26, 'slab', scale).displacement,
      })
    const timer = setTimeout(read, 300)
    document.documentElement.dataset.labReady = 'true'
    return () => clearTimeout(timer)
  }, [])
  return (
    <main className="profilePage">
      <div className="hidden">
        <CurrentGlassAt ref_={composer} kind="composer" width={600} />
        <CurrentGlassAt ref_={button} kind="button" width={52} />
      </div>
      <h1>倒角剖面與位移圖</h1>
      <div className="charts" data-testid="profiles">
        <Chart
          title="輸入框（52px 高）橫截面：表面高度"
          kind="composer"
          measure={0}
          unit="高度（1 = 平面）"
          max={1}
        />
        <Chart title="輸入框橫截面：位移量" kind="composer" measure={1} unit="位移 px" max={26} />
        <Chart
          title="圓形按鈕（52px）直徑截面：表面高度"
          kind="button"
          measure={0}
          unit="高度（1 = 平面）"
          max={1}
        />
        <Chart title="圓形按鈕直徑截面：位移量" kind="button" measure={1} unit="位移 px" max={26} />
      </div>
      <div className="maps" data-testid="maps">
        <MapView label="A 現狀 · 輸入框" href={maps.currentComposer ?? ''} />
        <MapView label="v1-B · 輸入框" href={maps.v1Composer ?? ''} />
        <MapView label="S2 · 輸入框" href={maps.slabComposer ?? ''} />
        <div className="buttonMaps">
          <MapView label="A · 按鈕" href={maps.currentButton ?? ''} />
          <MapView label="v1-B · 按鈕" href={maps.v1Button ?? ''} />
          <MapView label="S2 · 按鈕" href={maps.slabButton ?? ''} />
        </div>
      </div>
      <p className="mapNote">
        每張位移圖上排是原始圖（中性灰 = 不位移，紅綠通道 =
        位移方向），下排把位移強度放大成亮度：白色是位移最強處，黑色是完全不動。
      </p>
    </main>
  )
}
function CurrentGlassAt({
  ref_,
  kind,
  width,
}: {
  ref_: React.RefObject<HTMLDivElement | null>
  kind: LabKind
  width: number
}) {
  const glass = useGlass<HTMLDivElement>(currentKind[kind])
  return (
    <div
      ref={(node) => {
        glass.ref.current = node
        ref_.current = node
      }}
      data-glass={currentKind[kind]}
      style={{ position: 'absolute', width, height: 52, borderRadius: 26 }}
    />
  )
}

/*
 * Apple's HIG Materials discs, reproduced: a glass disc 157pt across centred on a 233pt picture,
 * at 2x, as in materials-ios-liquid-glass-*.png. ?page=disc&img=<picture>&look=<variant>.
 */
function DiscPage() {
  const shown = (query.get('look') ?? 'v3') as Shown | 'pane'
  useLayoutEffect(() => {
    document.documentElement.dataset.labReady = 'true'
  }, [])
  const image = query.get('img') ?? './liquid-glass-photo.svg'
  return (
    <main
      className="discPage"
      style={{
        backgroundImage: `url("${image}")`,
        ...(query.get('w') ? { width: '100vw', height: '100vh', backgroundSize: '100% 100%' } : {}),
      }}
    >
      {shown === 'pane' ? (
        <CurrentGlass kind="card" className="disc card" />
      ) : (
        <Glass
          variant={shown}
          kind="disc"
          className={`disc ${shown === 'current' ? 'lensTint' : ''}`}
          style={
            query.get('w')
              ? {
                  left: Number(query.get('x')),
                  top: Number(query.get('y')),
                  width: Number(query.get('w')),
                  height: Number(query.get('h')),
                  borderRadius: Number(query.get('r')),
                }
              : undefined
          }
        />
      )}
    </main>
  )
}
const pages = { slider: SliderPage, profile: ProfilePage, disc: DiscPage }
const Page = pages[query.get('page') as keyof typeof pages] ?? Comparison
createRoot(document.getElementById('root')!).render(<Page />)
Object.assign(window, { __labGlassReady: ready })
