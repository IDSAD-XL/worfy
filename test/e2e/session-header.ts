import type { Locator, Page } from '@playwright/test'

// The buttons of a Session Node's header (src/renderer/canvas/nodes/SessionNode.tsx). When the header
// is too narrow to leave the title its minimum, they go into the header's «⋯» menu one at a time from
// the end — Remove, Hide, Keep, then the action of the state (worfy-polish ticket 153). Which ones are
// in the menu depends on the fonts of the machine, so a test that only uses an action finds it in
// either place.

/** The narrowest a Session Node's title gets while a header button can still go into the menu: TITLE_MIN of SessionNode.tsx. */
export const TITLE_MIN = 64

/** The header's «⋯» menu, while it is open; the popup is drawn into the document's body, not into the Node. */
export const headerMenu = (window: Page): Locator => window.getByRole('menu', { name: 'Session actions' })

/**
 * The header action `name` of `node` (Resume, Keep, Hide, Remove…): its button in the header while it
 * is there, else its item of the «⋯» menu, which this opens.
 */
export async function headerAction(window: Page, node: Locator, name: string): Promise<Locator> {
  const header = node.getByTestId('session-node-header')
  const button = header.getByRole('button', { name, exact: true })
  if ((await button.count()) > 0) return button
  const menu = headerMenu(window)
  if ((await menu.count()) === 0) await header.getByTestId('session-node-more').click()
  return menu.locator('[role="menuitem"], [role="menuitemcheckbox"]').filter({ hasText: new RegExp(`^${name}$`) })
}

/** Closes the header's «⋯» menu if it is open, so the next step starts with it closed. */
export async function closeHeaderMenu(window: Page): Promise<void> {
  if ((await headerMenu(window).count()) > 0) await window.keyboard.press('Escape')
}

/** The width of `node`'s title in the Node's own pixels, whatever the zoom of the Canvas. */
export const titleWidth = (node: Locator): Promise<number> =>
  node.evaluate((element) => {
    const title = element.querySelector('[data-testid="session-node-title"]')
    const scale = element.getBoundingClientRect().width / (element as unknown as { offsetWidth: number }).offsetWidth
    return title === null ? 0 : title.getBoundingClientRect().width / scale
  })
