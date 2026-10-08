// Linked machines on two built worfy (worfy-link ticket 02; ADR-0052, points 4, 6 and 9): linking
// through "Link a machine" by the address 127.0.0.1:<port> and the code read from the other window,
// a wrong code, revoking from either side, and the access switch across a restart. Each worfy has
// its own data folder and so its own Machine; Bonjour is off and the link server listens on loopback
// only (launchApp). worfy-link ticket 09 adds its tests to this file.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { chooseByAddress, launchApp, launchLinkedPair, linkThroughUi, machineIdOf, openLinkDialog, shownCode, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

test.setTimeout(120_000)

const row = (window: Page, machineId: string) => window.locator(`[data-testid="machine-row"][data-machine-id="${machineId}"]`)

/** Revokes `machineId` from its row's context menu in `window`. */
async function revoke(window: Page, machineId: string): Promise<void> {
  await row(window, machineId).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Revoke' }).click()
}

test('two worfy link by address and code, and each lists the other as online', async () => {
  const a = await launchApp()
  let b: LaunchedApp | undefined
  try {
    b = await launchApp()
    // A fresh Machine: no Linked machine, only the button and the switch.
    await expect(a.window.getByTestId('machines-section')).toBeVisible()
    await expect(a.window.getByTestId('machine-row')).toHaveCount(0)
    await expect(a.window.getByTestId('link-machine-button')).toHaveText('Link a machine…')

    await openLinkDialog(a.window)
    await openLinkDialog(b.window)
    const code = await shownCode(b.window)
    await snapshotThemes(b.window, 'link-a-machine-code')

    // An address typed wrong shows its error under the field.
    await a.window.getByTestId('link-address-input').fill('127.0.0.1')
    await a.window.getByRole('button', { name: 'Next' }).click()
    await expect(a.window.getByTestId('link-address-error')).toHaveText('Add the port: host:port')

    await chooseByAddress(a.window, b.window)
    await snapshotThemes(a.window, 'link-a-machine-code-field')
    await a.window.getByTestId('link-code-input').fill(code)
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-success')).toBeVisible()
    await expect(b.window.getByTestId('link-success')).toBeVisible()
    const [aId, bId] = [await machineIdOf(a.window), await machineIdOf(b.window)]
    await expect(b.window.getByTestId('link-success')).toContainText(await nameOf(a.window))

    for (const window of [a.window, b.window]) await window.getByTestId('link-machine-dialog').getByRole('button', { name: 'Done' }).click()
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'online')
    await expect(row(b.window, aId)).toHaveAttribute('data-state', 'online')
    await expect(row(a.window, bId)).toContainText('Online')
    // A development build's "(dev)" stays visible, left of the chip, however long the name is.
    const suffix = row(a.window, bId).getByTestId('machine-name-suffix')
    await expect(suffix).toHaveText('(dev)')
    const suffixBox = await suffix.boundingBox()
    const chipBox = await row(a.window, bId).getByText('Online').boundingBox()
    expect(suffixBox).not.toBeNull()
    expect(chipBox).not.toBeNull()
    if (suffixBox && chipBox) expect(suffixBox.x + suffixBox.width).toBeLessThanOrEqual(chipBox.x)
    await snapshotThemes(a.window, 'machines-section')
  } finally {
    await a.close()
    await b?.close()
  }
})

test('a wrong code: a message on A, a new code on B, nothing linked', async () => {
  const a = await launchApp()
  let b: LaunchedApp | undefined
  try {
    b = await launchApp()
    await openLinkDialog(a.window)
    await openLinkDialog(b.window)
    await chooseByAddress(a.window, b.window)
    const code = await shownCode(b.window)
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0')
    await a.window.getByTestId('link-code-input').fill(wrong)
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-error')).toContainText('the code did not match')
    // The code is one-time: B shows a new one.
    await expect(b.window.getByTestId('link-code')).not.toHaveText(code)
    await expect(b.window.getByTestId('link-failure')).toBeVisible()
    await expect(a.window.getByTestId('machine-row')).toHaveCount(0)
    await expect(b.window.getByTestId('machine-row')).toHaveCount(0)

    // The new code links.
    await a.window.getByTestId('link-code-input').fill(await shownCode(b.window))
    await a.window.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(a.window.getByTestId('link-success')).toBeVisible()
    await expect(b.window.getByTestId('link-success')).toBeVisible()
  } finally {
    await a.close()
    await b?.close()
  }
})

test('revoking from A, then from B: the row goes on both within 5 s, and linking again by code works', async () => {
  const pair = await launchLinkedPair()
  try {
    const { a, b, aId, bId } = pair
    await revoke(a.window, bId)
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })

    await linkThroughUi(a.window, b.window)
    await revoke(b.window, aId)
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })

    await linkThroughUi(a.window, b.window)
  } finally {
    await pair.close()
  }
})

test('the access switch is off on a fresh Machine and stays on across a restart over the same data folder', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-link-access-'))
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const toggle = first.window.getByRole('switch', { name: 'Linked machines can work with my Projects' })
      await machineIdOf(first.window)
      await expect(toggle).toHaveAttribute('aria-checked', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-checked', 'true')
    } finally {
      await first.close()
    }
    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(second.window)
      await expect(second.window.getByRole('switch', { name: 'Linked machines can work with my Projects' })).toHaveAttribute('aria-checked', 'true')
    } finally {
      await second.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

/** The Machine name of the worfy whose window this is. */
async function nameOf(window: Page): Promise<string> {
  const result = await window.evaluate(() =>
    (globalThis as unknown as { worfy: { invoke(channel: string): Promise<{ ok: boolean; value?: { machine: { name: string } | null } }> } }).worfy.invoke('link.state'),
  )
  const name = result.value?.machine?.name
  if (name === undefined) throw new Error('no Machine name')
  return name
}
