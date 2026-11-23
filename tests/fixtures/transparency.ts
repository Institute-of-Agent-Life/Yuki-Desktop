import { expect, type Page } from '@playwright/test'

/**
 * Sets the window's transparency on Appearance's slider (settings open on 外觀), as a person
 * would with the keyboard: 0 is opaque, 70 the default frost. Each key is saved as it is pressed.
 */
export async function chooseTransparency(page: Page, value: number) {
  const slider = page.getByRole('slider', { name: '透明度', exact: true })
  await slider.focus()
  const steps = (value - Number(await slider.getAttribute('aria-valuenow'))) / 5
  for (let step = 0; step < Math.abs(steps); step++)
    await page.keyboard.press(steps > 0 ? 'ArrowRight' : 'ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuenow', String(value))
}
