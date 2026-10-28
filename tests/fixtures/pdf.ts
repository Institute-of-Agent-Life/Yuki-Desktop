import { expect, type Frame, type Locator } from '@playwright/test'

/** Inspect the loaded Chromium viewer belonging to this visible preview. */
export async function expectPdfPages(preview: Locator, pages: number) {
  await expect(preview).toBeVisible()
  const source = await preview.getAttribute('src')
  let viewerFrame: Frame | undefined
  await expect
    .poll(
      async () => {
        const element = await preview.elementHandle()
        const root = await element!.contentFrame()
        await element!.dispose()
        if (!root || root.url() !== source) return false
        const pending = [root]
        while (pending.length) {
          const frame = pending.shift()!
          if (await frame.locator('pdf-viewer').count()) {
            viewerFrame = frame
            return true
          }
          pending.push(...frame.childFrames())
        }
        return false
      },
      { message: 'The current PDF preview must attach its Chromium viewer' },
    )
    .toBe(true)
  const viewer = viewerFrame!.locator('pdf-viewer'),
    toolbar = viewer.locator('viewer-toolbar'),
    progress = toolbar.locator('#progress'),
    currentPage = toolbar.locator('viewer-page-selector #pageSelector')
  // Page selectors initially default to 1; completed loading must be proven first.
  await expect(toolbar).not.toHaveAttribute('loading')
  await expect(progress).toHaveAttribute('aria-valuenow', '100')
  await expect(progress).toBeHidden()
  await expect(viewer.locator('viewer-error-dialog')).toBeHidden()
  await expect(currentPage).toBeVisible()
  await expect(currentPage).toHaveValue('1')
  await expect(toolbar.locator('viewer-page-selector #pagelength')).toHaveText(String(pages))
}
