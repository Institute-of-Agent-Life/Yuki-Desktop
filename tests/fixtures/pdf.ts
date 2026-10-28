import { expect, type Frame, type Locator } from '@playwright/test'

/** Inspect the loaded Chromium viewer belonging to this visible preview. */
export async function expectPdfPages(preview: Locator, pages: number) {
  await preview.page().bringToFront()
  await expect(preview).toBeVisible()
  await preview.scrollIntoViewIfNeeded()
  await expect(preview).toBeInViewport()
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
          let viewers: number
          try {
            viewers = await frame.locator('pdf-viewer').count()
          } catch (error) {
            if (frame.isDetached()) return false
            throw error
          }
          if (viewers) {
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
  // Chromium 148 exposes its actual LoadState.SUCCESS through this testing contract.
  // Toolbar defaults and page selectors do not establish that a document loaded.
  await expect
    .poll(() =>
      viewer.evaluate((element) =>
        (
          element as HTMLElement & {
            getLoadSucceededForTesting(): boolean
          }
        ).getLoadSucceededForTesting(),
      ),
    )
    .toBe(true)
  await expect(preview).toHaveAttribute('src', source!)
  await expect(progress).toBeHidden()
  await expect(viewer.locator('viewer-error-dialog')).toBeHidden()
  await expect(currentPage).toBeVisible()
  await expect(currentPage).toHaveValue('1')
  await expect(toolbar.locator('viewer-page-selector #pagelength')).toHaveText(String(pages))
}
