import type { Page } from '@playwright/test'

/** The source stays in the row's technical tooltip when its visible label is shortened. */
export const artifactRow = (page: Page, id: string) =>
  page.getByRole('button').filter({ has: page.getByTitle(new RegExp(`^${id} ·`)) })
