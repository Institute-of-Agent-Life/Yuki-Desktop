import type { Locator } from '@playwright/test'

/*
 * What a glass's filter is made of (materials/glass.ts, the macOS Dock's glass): its blur, its
 * bends, its colour, and its rim, read off the rim's map (levels added, held in alpha as 128 +
 * levels) at the top's outermost pixel and 3pt in.
 */
export interface DockGlass {
  backdrop: string
  blur: string | null
  bends: number
  /** The gain the colour's distance from grey is raised by, or null with no filter of its own. */
  gain: number | null
  /** The rim, added to what the tone gives (levels), or null where there is none. */
  rim: { added: boolean; edge: number; inside: number } | null
  tint: string
}

export function dockGlass(pane: Locator): Promise<DockGlass> {
  return pane.evaluate(async (element) => {
    const style = getComputedStyle(element),
      backdrop = style.backdropFilter
    const id = backdrop.match(/url\("?#(yuki-glass-[^")]+)/)?.[1]
    const filter = id ? document.getElementById(id) : null
    const composite = filter?.querySelector('feComposite[in="rimGrey"]')
    let rim: DockGlass['rim'] = null
    if (filter && composite) {
      // The piece along the top: from the start of the glass across, the widest at y 0.
      const piece = [...filter.querySelectorAll('feImage')]
        .filter((node) => node.getAttribute('result')?.startsWith('bevel-'))
        .filter((node) => Number(node.getAttribute('y')) === 0)
        .sort((a, b) => Number(b.getAttribute('width')) - Number(a.getAttribute('width')))[0]!
      const image = new Image()
      image.src = piece.getAttribute('href')!
      await image.decode()
      const canvas = new OffscreenCanvas(image.width, image.height),
        context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const scale = image.height / Number(piece.getAttribute('height'))
      const at = (depth: number) =>
        context.getImageData(Math.floor(image.width / 2), Math.floor(depth * scale), 1, 1)
          .data[3]! - 128
      rim = {
        added: composite.getAttribute('k2') === '1' && !composite.hasAttribute('k1'),
        edge: at(0.25),
        inside: at(3),
      }
    }
    return {
      backdrop,
      blur: backdrop.match(/blur\(([\d.]+px)\)/)?.[1] ?? null,
      bends: filter?.querySelectorAll('feDisplacementMap').length ?? 0,
      gain: filter ? Number(filter.querySelector('[result="toned"]')!.getAttribute('k3')) : null,
      rim,
      tint: style.backgroundColor,
    }
  })
}

/** The rim's levels at points of the glass (CSS pixels from its top left), read off its map. */
export function rimAt(pane: Locator, points: [number, number][]): Promise<number[]> {
  return pane.evaluate(async (element, points) => {
    const id = getComputedStyle(element).backdropFilter.match(/url\("?#(yuki-glass-[^")]+)/)![1]!
    const pieces = [...document.getElementById(id)!.querySelectorAll('feImage')].filter((node) =>
      node.getAttribute('result')!.startsWith('bevel-'),
    )
    return Promise.all(
      points.map(async ([x, y]) => {
        const piece = pieces.find((node) => {
          const [px, py, pw, ph] = ['x', 'y', 'width', 'height'].map((key) =>
            Number(node.getAttribute(key)),
          )
          return x >= px! && x < px! + pw! && y >= py! && y < py! + ph!
        })!
        const [px, py, pw, ph] = ['x', 'y', 'width', 'height'].map((key) =>
          Number(piece.getAttribute(key)),
        )
        const image = new Image()
        image.src = piece.getAttribute('href')!
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height),
          context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const alpha = context.getImageData(
          Math.min(image.width - 1, Math.floor(((x - px!) / pw!) * image.width)),
          Math.min(image.height - 1, Math.floor(((y - py!) / ph!) * image.height)),
          1,
          1,
        ).data[3]!
        return alpha - 128
      }),
    )
  }, points)
}
