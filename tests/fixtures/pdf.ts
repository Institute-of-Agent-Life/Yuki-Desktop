import { expect, type Frame, type Locator } from '@playwright/test'

/** Inspect the loaded Chromium viewer belonging to this visible preview. */
export async function expectPdfPages(preview: Locator, pages: number) {
  await preview.page().bringToFront()
  let source: string | null = null
  let viewerFrame: Frame | undefined
  await expect
    .poll(
      async () => {
        const element = await preview.elementHandle()
        const currentSource = await element!.evaluate((element) => {
          if (!element.isConnected) return null
          element.scrollIntoView({ block: 'nearest' })
          return element.getAttribute('src')
        })
        if (!currentSource) {
          await element!.dispose()
          return false
        }
        const root = await element!.contentFrame()
        await element!.dispose()
        if (!root || root.url() !== currentSource) return false
        const pending = [root]
        while (pending.length) {
          const frame = pending.shift()!
          try {
            const viewer = frame.locator('pdf-viewer')
            if (await viewer.count()) {
              // Keep following the current guest until Chromium reports LoadState.SUCCESS.
              // A tag can exist before its initial guest is replaced.
              const state = await viewer.evaluate((element) => {
                if (!customElements.get('pdf-viewer')) return null
                const pdf = element as HTMLElement & {
                  getLoadSucceededForTesting(): boolean
                  showErrorDialog: boolean
                }
                return { loaded: pdf.getLoadSucceededForTesting(), failed: pdf.showErrorDialog }
              })
              if ((await preview.getAttribute('src')) !== currentSource) return false
              if (!state) return false
              if (state.failed) throw Error('The current PDF viewer reported a document load error')
              if (!state.loaded) return false
              source = currentSource
              viewerFrame = frame
              return true
            }
          } catch (error) {
            if (preview.page().isClosed()) throw error
            if (frame.isDetached() || frame.page().isClosed()) return false
            throw error
          }
          pending.push(...frame.childFrames())
        }
        return false
      },
      {
        message: 'The current PDF preview must load successfully in its Chromium viewer',
        // Native document initialization follows the original whole-test deadline.
        timeout: 0,
      },
    )
    .toBe(true)
  const viewer = viewerFrame!.locator('pdf-viewer'),
    toolbar = viewer.locator('viewer-toolbar'),
    progress = toolbar.locator('#progress'),
    currentPage = toolbar.locator('viewer-page-selector #pageSelector')
  await expect(preview).toHaveAttribute('src', source!)
  await expect(preview).toBeVisible()
  await expect(preview).toBeInViewport()
  await expect(progress).toBeHidden()
  await expect(viewer.locator('viewer-error-dialog')).toBeHidden()
  await expect(currentPage).toBeVisible()
  await expect(currentPage).toHaveValue('1')
  await expect(toolbar.locator('viewer-page-selector #pagelength')).toHaveText(String(pages))
}
