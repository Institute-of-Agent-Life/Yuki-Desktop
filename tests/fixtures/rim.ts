// A glass's light, read as it is laid around its edge: the map is a slice (`--rim-slice` image
// pixels top and bottom, then left and right) stretched into a border (`--rim-border`) whose
// middle repeats the slice's middle. Runs in the page (`locator.evaluate(readRim, points)`), and
// gives the light's coverage (0–255) at each CSS point of the glass.
export async function readRim(element: HTMLElement, points: [number, number][]) {
  const style = getComputedStyle(element)
  const image = new Image()
  image.src = style.getPropertyValue('--rim').match(/url\("?(.*?)"?\)$/)![1]!
  await image.decode()
  const canvas = new OffscreenCanvas(image.width, image.height),
    context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const [sliceY, sliceX] = style.getPropertyValue('--rim-slice').trim().split(/\s+/).map(Number)
  const [borderY, borderX] = style
    .getPropertyValue('--rim-border')
    .trim()
    .split(/\s+/)
    .map((value) => parseFloat(value))
  const width = element.offsetWidth,
    height = element.offsetHeight
  // Where a point `at` CSS pixels along a side of `length` falls in the image.
  const place = (at: number, length: number, slice: number, border: number, size: number) => {
    if (!slice) return Math.min(size - 1, Math.floor((at * size) / length))
    const scale = slice / border
    if (at < border) return Math.floor(at * scale)
    if (at >= length - border) return Math.min(size - 1, size - Math.ceil((length - at) * scale))
    return Math.floor(size / 2)
  }
  return {
    image: [image.width, image.height],
    slice: [sliceY!, sliceX!],
    border: [borderY!, borderX!],
    light: points.map(
      ([x, y]) =>
        context.getImageData(
          place(x, width, sliceX!, borderX!, image.width),
          place(y, height, sliceY!, borderY!, image.height),
          1,
          1,
        ).data[3]!,
    ),
  }
}
