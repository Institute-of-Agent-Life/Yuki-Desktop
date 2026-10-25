import { expect, test } from '@playwright/test'

test('an unselected role menu focuses its first actual item without selecting a connection', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/role-switcher.html')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  await toggle.press('Enter')
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true }),
    first = menu.getByRole('menuitemradio', { name: /First role/ }),
    second = menu.getByRole('menuitemradio', { name: /Second role/ })
  await expect(first).toBeFocused()
  await expect(first).toHaveAttribute('aria-checked', 'false')
  await expect(second).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByTestId('selected')).toHaveText('')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
  await page.keyboard.press('ArrowDown')
  await expect(second).toBeFocused()
  await expect(page.getByTestId('selected')).toHaveText('')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(page.getByTestId('selected')).toHaveText('second-role')
  await expect(page.getByTestId('selection-count')).toHaveText('1')
})

test('a role menu still prefers its existing selected item and Escape preserves the selection', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/role-switcher.html?selected=second')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  await toggle.press('Enter')
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true }),
    selected = menu.getByRole('menuitemradio', { name: /Second role/ })
  await expect(selected).toBeFocused()
  await expect(selected).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(page.getByTestId('selected')).toHaveText('second-role')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
})
