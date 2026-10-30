import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

async function artifact(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) })
  await writeFile(
    test.info().outputPath(`${name}.json`),
    JSON.stringify(
      {
        selected: await page.getByTestId('selected').textContent(),
        selections: await page.getByTestId('selection-count').textContent(),
        actions: JSON.parse((await page.getByTestId('actions').textContent())!),
        accessibility: await page.locator('main').ariaSnapshot(),
      },
      null,
      2,
    ),
  )
}

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
  await artifact(page, 'unselected-yuki-menu')
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
  const connect = menu.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }),
    deploy = menu.getByRole('menuitem', { name: '在這台電腦部署 Yuki', exact: true }),
    about = menu.getByRole('menuitem', { name: '關於 Second role', exact: true })
  await page.keyboard.press('End')
  await expect(about).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(deploy).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(connect).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(selected).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(connect).toBeFocused()
  await page.keyboard.press('Home')
  await expect(menu.getByRole('menuitemradio', { name: /First role/ })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(about).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(page.getByTestId('selected')).toHaveText('second-role')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
  await expect(page.getByTestId('actions')).toHaveText('[]')
  await artifact(page, 'selected-yuki-keyboard')
})

test('one Yuki keeps the whole avatar card trigger and routes each menu action without selecting again', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/role-switcher.html?mode=single')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  await expect(toggle).toHaveAccessibleDescription('First role Fixture status')
  await expect(toggle.locator('button')).toHaveCount(0)
  const actions = [
    ['連接另一個 Yuki', 'connect'],
    ['在這台電腦部署 Yuki', 'deploy'],
    ['關於 First role', 'about:first-role'],
  ] as const
  const completed: string[] = []
  for (const [label, action] of actions) {
    await toggle.press('Enter')
    const menu = page.getByRole('menu', { name: 'Yuki', exact: true })
    await expect(menu.getByRole('menuitemradio')).toHaveCount(1)
    await expect(menu.getByRole('menuitemradio')).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('menuitem', { name: label, exact: true }).press('Enter')
    completed.push(action)
    await expect(menu).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect(page.getByTestId('selected')).toHaveText('first-role')
    await expect(page.getByTestId('selection-count')).toHaveText('0')
    await expect(page.getByTestId('actions')).toHaveText(JSON.stringify(completed))
  }
  await toggle.press('Enter')
  await artifact(page, 'single-yuki-actions')
})

test('an empty Yuki menu focuses and activates the existing connection and deployment actions', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:4178/role-switcher.html?mode=empty')
  const toggle = page.getByRole('button', { name: '切換 Yuki', exact: true })
  await expect(toggle).toHaveAccessibleDescription('Yuki Desktop Fixture status')
  await toggle.press('Enter')
  const menu = page.getByRole('menu', { name: 'Yuki', exact: true }),
    connect = menu.getByRole('menuitem', { name: '連接另一個 Yuki', exact: true }),
    deploy = menu.getByRole('menuitem', { name: '在這台電腦部署 Yuki', exact: true })
  await expect(menu.getByRole('menuitemradio')).toHaveCount(0)
  await expect(menu.getByRole('menuitem')).toHaveText(['連接另一個 Yuki', '在這台電腦部署 Yuki'])
  await expect(connect).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(deploy).toBeFocused()
  await page.keyboard.press('Home')
  await expect(connect).toBeFocused()
  await page.keyboard.press('End')
  await expect(deploy).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(toggle).toBeFocused()
  await expect(page.getByTestId('actions')).toHaveText('["deploy"]')
  await toggle.press('Enter')
  await expect(connect).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('actions')).toHaveText('["deploy","connect"]')
  await expect(page.getByTestId('selected')).toHaveText('')
  await expect(page.getByTestId('selection-count')).toHaveText('0')
  await toggle.press('Enter')
  await artifact(page, 'empty-yuki-actions')
})
