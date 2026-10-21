export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function windowGeometry(
  work: Rect,
  saved?: Rect,
  mode: 'workspace' | 'pairing' = 'workspace',
) {
  const minimum = {
    width: Math.min(mode === 'pairing' ? 720 : 960, work.width),
    height: Math.min(mode === 'pairing' ? 560 : 640, work.height),
  }
  let width = saved?.width ?? (mode === 'pairing' ? 720 : Math.min(1440, work.width - 80))
  let height = saved?.height ?? (mode === 'pairing' ? 560 : Math.min(900, work.height - 80))
  if (!saved && (width < minimum.width || height < minimum.height)) {
    width = work.width
    height = work.height
  }
  width = Math.min(work.width, Math.max(minimum.width, width))
  height = Math.min(work.height, Math.max(minimum.height, height))
  const x = Math.min(
    work.x + work.width - width,
    Math.max(work.x, saved?.x ?? work.x + (work.width - width) / 2),
  )
  const y = Math.min(
    work.y + work.height - height,
    Math.max(work.y, saved?.y ?? work.y + (work.height - height) / 2),
  )
  return {
    minimum,
    bounds: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    },
  }
}

// The inset paper reserves 6px beside a readable 520px content area.
export const centerColumnMinimum = 526

export function columns(
  width: number,
  sidebar: number,
  inspector: number,
  sidebarOpen = true,
  inspectorOpen = true,
  autoInspectorWidth = false,
) {
  const overlaySidebar = width < 1100
  const overlayInspector = width < 1180
  let s = sidebarOpen && !overlaySidebar ? Math.min(320, Math.max(220, sidebar)) : 0
  const preferredInspector = autoInspectorWidth ? (width >= 1680 ? 440 : 380) : inspector
  let i = inspectorOpen && !overlayInspector ? Math.min(560, Math.max(320, preferredInspector)) : 0
  if (s && i && width - s - i < centerColumnMinimum) {
    i = Math.max(320, width - s - centerColumnMinimum)
    s = Math.min(s, width - i - centerColumnMinimum)
  }
  return { sidebar: s, inspector: i, center: width - s - i, overlaySidebar, overlayInspector }
}
