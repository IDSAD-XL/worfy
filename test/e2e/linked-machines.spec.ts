// Linked machines on two built worfy (worfy-link ticket 02; ADR-0052, points 4, 6 and 9): linking
// through "Link a machine" by the address 127.0.0.1:<port> and the code read from the other window,
// a wrong code, revoking from either side, and the access switch across a restart. Each worfy has
// its own data folder and so its own Machine; Bonjour is off and the link server listens on loopback
// only (launchApp). worfy-link ticket 09 adds its tests to this file.
//
// worfy-ui ticket 5: the Machines section of the sidebar is collapsed until the user expands it and
// shows a status dot next to its heading; the two switches are in Settings → Machines.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  canvasReady,
  chooseByAddress,
  chooseLevel,
  closeSettings,
  collapseMachines,
  expandMachines,
  icacls,
  KEEP_AWAKE_LABEL,
  launchApp,
  launchLinkedPair,
  linkThroughUi,
  machineIdOf,
  openLinkDialog,
  openMachinesSettings,
  PROJECTS_ACCESS_LABEL,
  repoRoot,
  setProjectsAccess,
  shownCode,
  smallestWindow,
  thisUser,
  type LaunchedApp,
} from './helpers'
import { snapshotThemes } from './snapshots'
import { catScript, loginProfileWithNode } from '../harness-node'

test.setTimeout(120_000)

/**
 * Takes away this user's right to add files to `folder` (`writable` false) or gives it back. Off
 * Windows the mode bits do it. On Windows they do not: a folder's read-only mode does not stop
 * writing into it, so an entry of the ACL denies this user adding a file or a folder to it (icacls
 * /deny, rights WD and AD), and creating a file there fails with EPERM; removing the deny entry gives
 * the rights back. `folder` is always inside the test's temporary folder.
 */
function setWritable(folder: string, writable: boolean): void {
  if (process.platform !== 'win32') return chmodSync(folder, writable ? 0o755 : 0o555)
  icacls(folder, writable ? '/remove:d' : '/deny', writable ? thisUser() : `${thisUser()}:(WD,AD)`)
}

/** The code main's refusal names: Windows maps a denied access to EPERM, macOS and Linux to EACCES. */
const DENIED = process.platform === 'win32' ? 'EPERM' : 'EACCES'

const row = (window: Page, machineId: string) => window.locator(`[data-testid="machine-row"][data-machine-id="${machineId}"]`)

/** Revokes `machineId` from its row's context menu in `window`; the row is in the body of the Machines section. */
async function revoke(window: Page, machineId: string): Promise<void> {
  await expandMachines(window)
  await row(window, machineId).click({ button: 'right' })
  await window.getByRole('menuitem', { name: 'Revoke' }).click()
}

const machinesRegion = (window: Page): Locator => window.getByRole('region', { name: 'Machines', exact: true })
const machinesHeading = (window: Page): Locator => machinesRegion(window).getByRole('button', { name: 'Machines', exact: true })
/** The status dot next to the heading "Machines"; it is an image with a name, and has no caption. */
const machinesDot = (window: Page): Locator => machinesRegion(window).getByRole('img')

/** The page's DOM, typed for this file: the e2e typecheck has no DOM library. */
interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
}
interface El {
  parentElement: El | null
  closest(selector: string): El | null
  querySelector(selector: string): El | null
  getBoundingClientRect(): Box
}
interface Computed {
  backgroundColor: string
  borderTopColor: string
  animationName: string
  animationDuration: string
  animationIterationCount: string
}

/** How the dot is drawn: the colour of the dot, and the ring that pulses around it. */
const dotPaint = (window: Page) =>
  machinesDot(window).evaluate((node) => {
    const style = (element: El, pseudo?: string): Computed => (globalThis as unknown as { getComputedStyle(element: El, pseudo?: string): Computed }).getComputedStyle(element, pseudo)
    const dot = node as unknown as El
    const core = style(dot, '::before')
    const ring = style(dot, '::after')
    return { colour: core.backgroundColor, ring: ring.animationName, ringColour: ring.borderTopColor, every: ring.animationDuration, times: ring.animationIterationCount }
  })

/** Where the dot is: its own box, the heading button left of it, and the boxes of the header that cut what leaves them. */
const dotPlace = (window: Page) =>
  machinesDot(window).evaluate((node) => {
    const dot = node as unknown as El
    const header = dot.closest('.w-sidebar-section__header')
    const box = (element: El | null): Box => {
      if (element === null) throw new Error('the dot is not in the header of a section')
      const { left, right, top, bottom, width, height } = element.getBoundingClientRect()
      return { left, right, top, bottom, width, height }
    }
    return { dot: box(dot), slot: box(dot.parentElement), header: box(header), heading: box(header?.querySelector('h2 button') ?? null) }
  })

test('two worfy link by address and code, and each lists the other as online', async () => {
  const a = await launchApp()
  let b: LaunchedApp | undefined
  try {
    b = await launchApp()
    // A fresh Machine: the Machines section is collapsed — its heading alone, with no dot.
    for (const window of [a.window, b.window]) {
      await machineIdOf(window)
      await expect(window.getByTestId('machines-section')).toBeVisible()
      await expect(machinesHeading(window)).toHaveAttribute('aria-expanded', 'false')
      await expect(window.getByTestId('link-machine-button')).toBeHidden()
      await expect(machinesDot(window)).toHaveCount(0)
    }
    expect((await a.window.getByTestId('machines-section').boundingBox())?.height).toBe(24)
    await snapshotThemes(a.window, 'machines-collapsed')
    // Expanded: no Linked machine, only the button. The switches are in Settings → Machines.
    await expandMachines(a.window)
    await expect(a.window.getByTestId('machine-row')).toHaveCount(0)
    await expect(a.window.getByTestId('link-machine-button')).toHaveText('Link a machine…')
    await expect(a.window.locator('.w-sidebar').getByRole('switch')).toHaveCount(0)
    await expect(machinesDot(a.window)).toHaveCount(0)

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
    // The rows are on screen: "Link a machine" was opened from the expanded section.
    await expect(row(a.window, bId)).toBeVisible()
    await expect(row(b.window, aId)).toBeVisible()
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

    // Both show the green dot next to the heading: one Linked machine is online.
    for (const window of [a.window, b.window]) {
      const dot = machinesDot(window)
      await expect(dot).toBeVisible()
      await expect(dot).toHaveAccessibleName('1 linked machine online')
      await expect(dot).toHaveAttribute('title', '1 linked machine online')
      await expect(dot).toHaveAttribute('data-state', 'online')
      // The section is still named by its heading alone.
      await expect(machinesHeading(window)).toHaveText('Machines')
    }
    // The green of the "Online" chip of the row; a ring of the same colour pulses every 2 s.
    const chipDot = await row(a.window, bId)
      .locator('.w-chip__dot')
      .evaluate((node) => (globalThis as unknown as { getComputedStyle(element: unknown): { backgroundColor: string } }).getComputedStyle(node).backgroundColor)
    const paint = await dotPaint(a.window)
    expect(paint.colour).toBe(chipDot)
    expect(paint.colour).not.toBe('rgba(0, 0, 0, 0)')
    expect(paint).toMatchObject({ ring: 'w-machines-dot-pulse', ringColour: chipDot, every: '2s', times: 'infinite' })
    // Right of the heading, in the header; the 12 px box the ring grows to is cut by nothing.
    const place = await dotPlace(a.window)
    expect(place.dot.width).toBe(12)
    expect(place.dot.height).toBe(12)
    expect(place.dot.left).toBeGreaterThanOrEqual(place.heading.right)
    expect(place.dot.left - place.heading.right).toBeLessThanOrEqual(8)
    for (const around of [place.slot, place.header]) {
      expect(around.left).toBeLessThanOrEqual(place.dot.left)
      expect(around.right).toBeGreaterThanOrEqual(place.dot.right)
      expect(around.top).toBeLessThanOrEqual(place.dot.top)
      expect(around.bottom).toBeGreaterThanOrEqual(place.dot.bottom)
    }
    await snapshotThemes(a.window, 'machines-section')

    // With "reduce motion" of the system the dot is still: no ring pulses.
    await a.window.emulateMedia({ reducedMotion: 'reduce' })
    expect(await dotPaint(a.window)).toMatchObject({ colour: chipDot, ring: 'none' })
    await a.window.emulateMedia({ reducedMotion: null })
    expect((await dotPaint(a.window)).ring).toBe('w-machines-dot-pulse')

    // Collapsed again, as a fresh worfy shows the section: the rows are hidden, the dot stays.
    await collapseMachines(a.window)
    await expect(row(a.window, bId)).toBeHidden()
    await expect(machinesDot(a.window)).toBeVisible()
    await expect(machinesDot(a.window)).toHaveAccessibleName('1 linked machine online')
    expect((await a.window.getByTestId('machines-section').boundingBox())?.height).toBe(24)
    expect(await dotPlace(a.window)).toStrictEqual(place)
    // A click on the dot does not expand the section.
    await machinesDot(a.window).click()
    await expect(machinesHeading(a.window)).toHaveAttribute('aria-expanded', 'false')
    await snapshotThemes(a.window, 'machines-dot')

    // The other worfy quits: nobody is online, so the dot goes; the Linked machine stays in the list.
    await b.close()
    b = undefined
    await expect(machinesDot(a.window)).toHaveCount(0, { timeout: 20_000 })
    await expandMachines(a.window)
    await expect(row(a.window, bId)).toBeVisible()
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'unavailable')
    await expect(row(a.window, bId)).toContainText('Unavailable')
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
    for (const window of [a.window, b.window]) await expect(machinesDot(window)).toHaveAccessibleName('1 linked machine online')
    await revoke(a.window, bId)
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })
    // No Linked machine on either side: the dot is gone from both.
    for (const window of [a.window, b.window]) await expect(machinesDot(window)).toHaveCount(0)

    await linkThroughUi(a.window, b.window)
    for (const window of [a.window, b.window]) await expect(machinesDot(window)).toHaveAccessibleName('1 linked machine online')
    // A collapses its section; revoked from B, the dot of the collapsed section goes too.
    await collapseMachines(a.window)
    await expect(machinesDot(a.window)).toBeVisible()
    await revoke(b.window, aId)
    await expect(row(b.window, aId)).toHaveCount(0, { timeout: 5_000 })
    await expect(row(a.window, bId)).toHaveCount(0, { timeout: 5_000 })
    for (const window of [a.window, b.window]) await expect(machinesDot(window)).toHaveCount(0)
    await expect(machinesHeading(a.window)).toHaveAttribute('aria-expanded', 'false')

    await linkThroughUi(a.window, b.window)
  } finally {
    await pair.close()
  }
})

/** The line under the access switch of Settings → Machines (ADR-0060). */
const STARTED_WORK_KEEPS_RUNNING = 'Work already started from a Linked machine keeps running'

/** "Link through Tailscale" in Settings → Machines (worfy-link ticket 27; ADR-0070, point 3). */
const TAILSCALE_LABEL = 'Link through Tailscale'

type SavedLinkSettings = { projectsAccess: boolean; machines?: Record<string, string>; keepAwake?: boolean; tailscale?: boolean }

/** What link/settings.json of the data folder says, once worfy has written it (src/main/link/settings.ts). */
function savedLinkSettings(dataDir: string): SavedLinkSettings | null {
  const file = join(dataDir, 'link', 'settings.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SavedLinkSettings) : null
}

test('Settings → Machines: the access switch is off on a fresh Machine and stays on across a restart over the same data folder', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-link-access-'))
  try {
    const first = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(first.window)
      // The window has no switch while Settings is closed: the sidebar has none.
      await expect(first.window.getByRole('switch')).toHaveCount(0)

      const dialog = await openMachinesSettings(first)
      // "Machines" is a row of the section list, after General.
      const sections = dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button')
      await expect(sections.first()).toHaveText('General')
      await expect(sections.filter({ hasText: /^Machines$/ })).toHaveAttribute('aria-current', 'true')
      const access = dialog.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true })
      const keepAwake = dialog.getByRole('switch', { name: KEEP_AWAKE_LABEL, exact: true })
      const tailscale = dialog.getByRole('switch', { name: TAILSCALE_LABEL, exact: true })
      await expect(dialog.getByRole('switch')).toHaveCount(3)
      for (const toggle of [access, keepAwake, tailscale]) await expect(toggle).toBeVisible()
      // "Link through Tailscale" is off on a fresh Machine, and can be switched with access off.
      await expect(tailscale).toBeEnabled()
      await expect(tailscale).toHaveAttribute('aria-checked', 'false')
      await expect(dialog.getByText(TAILSCALE_LABEL, { exact: true })).toBeVisible()
      // As a fresh Machine has them: access off, keep-awake on in link/settings.json. With access off
      // sleep is not kept away, so keep-awake is disabled, shows off and says why. Both labels and
      // the line under the access switch are on screen.
      await expect(access).toBeEnabled()
      await expect(access).toHaveAttribute('aria-checked', 'false')
      await expect(keepAwake).toBeDisabled()
      await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
      await expect(keepAwake).toHaveAttribute('title', `Turn on "${PROJECTS_ACCESS_LABEL}" first`)
      await expect(dialog.getByText(PROJECTS_ACCESS_LABEL, { exact: true })).toBeVisible()
      await expect(dialog.getByText(KEEP_AWAKE_LABEL, { exact: true })).toBeVisible()
      await expect(dialog.getByTestId('settings-machines-access-row').getByText(STARTED_WORK_KEEPS_RUNNING, { exact: true })).toBeVisible()
      // Drawn unlike the enabled "off" of access: a dashed outline without a fill, and a dimmed label.
      const look = (locator: Locator) =>
        locator.evaluate((node) => {
          const style = (globalThis as unknown as { getComputedStyle: (n: unknown) => { borderTopStyle: string; color: string } }).getComputedStyle(node)
          return { borderTopStyle: style.borderTopStyle, color: style.color }
        })
      expect((await look(keepAwake)).borderTopStyle).toBe('dashed')
      expect((await look(access)).borderTopStyle).toBe('solid')
      expect((await look(dialog.getByText(KEEP_AWAKE_LABEL, { exact: true }))).color).not.toBe((await look(dialog.getByText(PROJECTS_ACCESS_LABEL, { exact: true }))).color)
      await snapshotThemes(first.window, 'settings-machines')

      await access.click()
      await expect(access).toHaveAttribute('aria-checked', 'true')
      // Access on: keep-awake works and shows the value kept, on; the line stays.
      await expect(keepAwake).toBeEnabled()
      await expect(keepAwake).toHaveAttribute('aria-checked', 'true')
      await expect(keepAwake).not.toHaveAttribute('title')
      await expect(dialog.getByText(STARTED_WORK_KEEPS_RUNNING, { exact: true })).toBeVisible()
      await snapshotThemes(first.window, 'settings-machines-access-on')
      // Written where the sidebar's switch wrote it.
      await expect.poll(() => savedLinkSettings(dataDir)).toStrictEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: true, tailscale: false })
      // "Link through Tailscale" on is written next to the other switches, and off again.
      await tailscale.click()
      await expect(tailscale).toHaveAttribute('aria-checked', 'true')
      await expect.poll(() => savedLinkSettings(dataDir)).toStrictEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: true, tailscale: true })
      await tailscale.click()
      await expect(tailscale).toHaveAttribute('aria-checked', 'false')
      await expect.poll(() => savedLinkSettings(dataDir)).toStrictEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: true, tailscale: false })
      // Closing Settings loses nothing: open again, the switch is on. The sidebar still has no
      // switch, with its Machines section expanded too.
      await closeSettings(first.window)
      await expect(first.window.getByRole('switch')).toHaveCount(0)
      await expandMachines(first.window)
      await expect(first.window.getByRole('switch')).toHaveCount(0)
      const again = await openMachinesSettings(first)
      await expect(again.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true })).toHaveAttribute('aria-checked', 'true')
      await expect(again.getByRole('switch', { name: KEEP_AWAKE_LABEL, exact: true })).toHaveAttribute('aria-checked', 'true')
      await closeSettings(first.window)
    } finally {
      await first.close()
    }
    const second = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await machineIdOf(second.window)
      // The section the user expanded before the restart is expanded.
      await expect(machinesHeading(second.window)).toHaveAttribute('aria-expanded', 'true')
      const dialog = await openMachinesSettings(second)
      const access = dialog.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true })
      await expect(access).toBeVisible()
      await expect(access).toHaveAttribute('aria-checked', 'true')
      await expect(dialog.getByRole('switch', { name: KEEP_AWAKE_LABEL, exact: true })).toHaveAttribute('aria-checked', 'true')
    } finally {
      await second.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('Settings → Machines in the smallest window: a refusal of main is shown as it is; the keyboard and Esc work after a click on a label', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-link-settings-'))
  const linkDir = join(dataDir, 'link')
  try {
    const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const { window } = launched
      await machineIdOf(window)
      // The smallest window worfy allows: 800×520 outside, a little less inside on Windows.
      await smallestWindow(launched)

      const dialog = await openMachinesSettings(launched)
      const access = dialog.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true })
      const keepAwake = dialog.getByRole('switch', { name: KEEP_AWAKE_LABEL, exact: true })
      const labels = [dialog.getByText(PROJECTS_ACCESS_LABEL, { exact: true }), dialog.getByText(KEEP_AWAKE_LABEL, { exact: true })]
      // Both rows are whole on screen: nothing is cut and the section does not scroll.
      for (const part of [access, keepAwake, ...labels]) await expect(part).toBeInViewport({ ratio: 1 })
      for (const [index, toggle] of [access, keepAwake].entries()) {
        const label = (await labels[index]!.boundingBox())!
        const control = (await toggle.boundingBox())!
        // The label left of its switch, on its row.
        expect(label.x + label.width).toBeLessThanOrEqual(control.x)
        expect(control.y).toBeGreaterThanOrEqual(label.y - 16)
        expect(control.y + control.height).toBeLessThanOrEqual(label.y + label.height + 16)
      }
      await expect(access).toHaveAttribute('aria-checked', 'false')

      // main cannot write link/settings.json: the folder is read-only.
      const error = dialog.getByTestId('settings-machines-error')
      await expect(error).toHaveCount(0)
      setWritable(linkDir, false)
      try {
        await access.click()
        await expect(error).toBeVisible()
        await expect(error).toHaveAttribute('role', 'alert')
        // The message of main itself: the channel, the reason and the temporary file it could not
        // write next to link/settings.json.
        await expect(error).toContainText(`link.setAccess failed: ${DENIED}`)
        await expect(error).toContainText(join(linkDir, '.settings.json.'))
        await expect(error).toBeInViewport({ ratio: 1 })
        // The long path wraps inside the section: the window gets no horizontal scroll.
        const body = dialog.locator('.w-settings__body')
        expect(await body.evaluate((node) => (node as unknown as { scrollWidth: number; clientWidth: number }).scrollWidth - (node as unknown as { scrollWidth: number; clientWidth: number }).clientWidth)).toBe(0)
        // Nothing changed: the switch is off, and so is the file.
        await expect(access).toHaveAttribute('aria-checked', 'false')
        expect(savedLinkSettings(dataDir)?.projectsAccess ?? false).toBe(false)
        await snapshotThemes(window, 'settings-machines-error')
      } finally {
        setWritable(linkDir, true)
      }

      // A click on the text of a label switches nothing, and leaves the keyboard in the window:
      // Tab goes to a control of Settings.
      // The label of the access switch: that switch is enabled, so a switch here would be a click
      // that went through the label (keep-awake is disabled while access is off).
      await expect(access).toBeEnabled()
      await labels[0]!.click()
      await expect(access).toHaveAttribute('aria-checked', 'false')
      expect(savedLinkSettings(dataDir)?.projectsAccess ?? false).toBe(false)
      // Access is off: keep-awake shows off, although link/settings.json keeps it on.
      await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
      await window.keyboard.press('Tab')
      await expect(dialog.locator(':focus')).toHaveCount(1)
      // Space on the switch: main can write again, so it switches, the message goes, and the focus
      // stays on the switch.
      await access.focus()
      await window.keyboard.press('Space')
      await expect(access).toHaveAttribute('aria-checked', 'true')
      await expect(access).toBeFocused()
      await expect(error).toHaveCount(0)
      await expect.poll(() => savedLinkSettings(dataDir)).toStrictEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: true, tailscale: false })
      // Tab goes on to the next switch; Enter switches it off.
      await window.keyboard.press('Tab')
      await expect(keepAwake).toBeFocused()
      await window.keyboard.press('Enter')
      await expect(keepAwake).toHaveAttribute('aria-checked', 'false')
      await expect(keepAwake).toBeFocused()
      await expect.poll(() => savedLinkSettings(dataDir)).toStrictEqual({ version: 2, projectsAccess: true, machines: {}, keepAwake: false, tailscale: false })

      // After a click on a label, Esc still closes Settings.
      await labels[0]!.click()
      await window.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
    } finally {
      // A give-back that throws still closes the app.
      try {
        if (existsSync(linkDir)) setWritable(linkDir, true)
      } finally {
        await launched.close()
      }
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

// ── Projects of Linked machines in the sidebar and on the Canvas (worfy-link ticket 09) ─────────

/** Where the snapshots of ticket 09 are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-link', 'evidence')

/**
 * Takes the light and dark snapshot of `window` (test-results/e2e/snapshots/09-<name>/). With
 * WORFY_EVIDENCE=1 both are also kept as the ticket's evidence `09-<name>-{light,dark}.png`; an
 * ordinary run (gate full) leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `09-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `09-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `09-${name}-dark.png`))
}

const group = (window: Page, machineId: string) => window.locator(`[data-testid="machine-group"][data-machine-id="${machineId}"]`)
const projectRow = (window: Page, machineId: string, projectId: string) =>
  group(window, machineId).locator(`[data-testid="project-row"][data-project-id="${projectId}"]`)

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** Calls a channel of the window's own main through the preload, the way the renderer does. */
async function call<T>(window: Page, channel: string, input?: unknown): Promise<T> {
  const result = await window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)
  if (!result.ok) throw new Error(`${channel}: ${result.error ?? 'failed'}`)
  return result.value as T
}

/** A folder with a git repository on branch main, for a Project. */
function gitRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path, env: gitEnv })
  return realpathSync(path)
}

/** A data folder whose projects.json lists `projects`, the first one active. */
function dataFolder(path: string, projects: { id: string; name: string; path: string }[]): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects, activeId: projects[0]?.id ?? null }))
  return path
}

test('the sidebar of A lists the Projects of B under B, with its state; not shared — none and a line; B closed — unavailable', async () => {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-sidebar-')))
  const ownRepo = gitRepo(join(scratch, 'alpha-repo'))
  const bRepo = gitRepo(join(scratch, 'beta-repo'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: 'alpha-repo-0000000a', name: 'alpha-repo', path: ownRepo }])
  const bData = dataFolder(join(scratch, 'b-data'), [{ id: 'beta-repo-0000000b', name: 'beta-repo', path: bRepo }])
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bData } })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setProjectsAccess(b, true)

    // This Machine first, then B, online, with its Project.
    await expect(a.window.getByTestId('machine-group')).toHaveCount(2)
    await expect(a.window.getByTestId('machine-group').first()).toHaveAttribute('data-state', 'this')
    await expect(group(a.window, bId)).toHaveAttribute('data-state', 'online')
    await expect(group(a.window, bId)).toContainText('Online')
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toContainText('beta-repo')
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toContainText('main')
    await evidence(a.window, 'sidebar-online')

    // B stops sharing: its group stays, without Projects, with a line that says so.
    await setProjectsAccess(b, false)
    await expect(group(a.window, bId)).toHaveAttribute('data-sharing', 'no')
    await expect(group(a.window, bId).getByTestId('machine-not-sharing')).toHaveText(/ doesn't share its Projects$/)
    await expect(group(a.window, bId).getByTestId('project-row')).toHaveCount(0)
    await evidence(a.window, 'sidebar-not-shared')

    // Shared again: the Projects come back without a restart.
    await setProjectsAccess(b, true)
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toBeVisible()

    // B closed: unavailable.
    await b.close()
    b = undefined
    await expect(group(a.window, bId)).toHaveAttribute('data-state', 'unavailable', { timeout: 20_000 })
    await expect(group(a.window, bId)).toContainText('Unavailable')
    await expect(group(a.window, bId).getByTestId('project-row')).toHaveCount(0)
    await evidence(a.window, 'sidebar-unavailable')
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

const BETA = 'beta-0000000b'
const SHARED = 'shared-0000005c'
const EPIC = 'demo'
const SIZE = { width: 1400, height: 900 }

function git(cwd: string, ...args: string[]): void {
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env: gitEnv })
}

/**
 * B of the Canvas tests: a committed repository `beta` with Epic `demo` (two open Tickets) and an
 * epic-status in B's Claude home that answers them; a Layout with a note and a Terminal Node; and
 * `shared`, one folder that A lists too.
 */
function prepareB(scratch: string, shared: string) {
  const repo = join(scratch, 'beta')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const num of [1, 2]) {
    writeFileSync(join(issues, `0${num}-ticket-${num}.md`), [`# 0${num} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', ''].join('\n'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  const claudeHome = join(scratch, 'b-claude')
  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: [1, 2].map((num) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `0${num} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)
  const dataDir = dataFolder(join(scratch, 'b-data'), [
    { id: BETA, name: 'beta', path: realpathSync(repo) },
    { id: SHARED, name: 'shared', path: shared },
  ])
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  mkdirSync(join(dataDir, BETA), { recursive: true })
  writeFileSync(
    join(dataDir, BETA, 'layout.json'),
    JSON.stringify({
      nodes: [
        { id: 'note-b', kind: 'note', x: 1300, y: 60, w: 220, h: 120, ...base, data: { text: 'A note of B' } },
        { id: 'term', kind: 'terminal', x: 1300, y: 260, w: 520, h: 300, ...base, data: {} },
      ],
      viewport: { x: 0, y: 0, zoom: 0.5 },
    }),
  )
  const home = join(scratch, 'b-home')
  mkdirSync(home, { recursive: true })
  // B's login shell is /bin/sh with this HOME: its .profile puts node on PATH, for the Node stubs.
  loginProfileWithNode(home)
  return {
    dataDir,
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', SHELL: '/bin/sh', HOME: home },
  }
}

/** Replaces Electron's powerSaveBlocker in main, so an Autopilot run never keeps the Mac awake. */
async function stubPower(app: LaunchedApp['app']): Promise<void> {
  await app.evaluate(({ powerSaveBlocker }) => {
    let next = 100
    const started = new Set<number>()
    powerSaveBlocker.start = () => {
      next += 1
      started.add(next)
      return next
    }
    powerSaveBlocker.stop = (id) => started.delete(id)
    powerSaveBlocker.isStarted = (id) => started.has(id)
  })
}

/** The flow position of a Node as React Flow draws it: its transform `translate(x, y)`. */
async function drawnAt(window: Page, nodeId: string): Promise<string> {
  return (await window.locator(`.react-flow__node[data-id="${nodeId}"]`).getAttribute('style'))?.match(/translate\([^)]*\)/)?.[0] ?? ''
}

/** Drags `from` by (dx, dy) with the mouse, once the Canvas is at rest. */
async function drag(launched: LaunchedApp, from: Locator, dx: number, dy: number): Promise<void> {
  await canvasReady(launched, { visible: [from] })
  const box = await from.boundingBox()
  if (box === null) throw new Error('nothing to drag')
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await launched.window.mouse.move(start.x, start.y)
  await launched.window.mouse.down()
  await launched.window.mouse.move(start.x + dx, start.y + dy, { steps: 12 })
  await launched.window.mouse.up()
}

const screenText = async (node: Locator): Promise<string> => (await node.locator('.xterm-rows').innerText()).replace(/\u00a0/g, ' ')

// ── The access level of each Linked machine (worfy-link ticket 18; ADR-0066) ────────────────────

/**
 * The light and dark snapshot of `window` (test-results/e2e/snapshots/18-<name>/); with
 * WORFY_EVIDENCE=1 also the ticket's evidence `18-<name>-{light,dark}.png`, as evidence() does for 09.
 */
async function evidence18(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `18-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `18-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `18-${name}-dark.png`))
}

test('Settings → Machines: a level per Linked machine; with Read only A sees the Projects of B and a change is refused; Full access lets it through', async () => {
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-18-levels-')))
  const bRepo = gitRepo(join(scratch, 'beta-repo'))
  const aData = dataFolder(join(scratch, 'a-data'), [])
  const bData = dataFolder(join(scratch, 'b-data'), [{ id: 'beta-repo-0000000b', name: 'beta-repo', path: bRepo }])
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bData } })
    await linkThroughUi(a.window, b.window)
    const aId = await machineIdOf(a.window)
    const bId = await machineIdOf(b.window)
    const invokeOnB = (channel: string, input: unknown) =>
      a.window.evaluate(([machine, name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke('linked.invoke', { machine, channel: name, input: value }), [bId, channel, input] as const)

    // On B: A has a row of its own, Off as a newly linked Machine, disabled while access is off.
    const dialog = await openMachinesSettings(b)
    const level = dialog.getByTestId(`link-machine-access-${aId}`)
    const levelRow = dialog.getByTestId(`settings-machines-level-row-${aId}`)
    await expect(level).toHaveAttribute('data-value', 'off')
    await expect(level).toBeDisabled()
    await expect(levelRow).toHaveAttribute('data-disabled', '')
    await dialog.getByRole('switch', { name: PROJECTS_ACCESS_LABEL, exact: true }).click()
    await expect(level).toBeEnabled()
    await expect(levelRow).toContainText('Cannot see or change your Projects')
    // The switch alone opens nothing: A's level is still Off.
    await expect(group(a.window, bId)).toHaveAttribute('data-sharing', 'no')

    await chooseLevel(b.window, level, 'read')
    // Said plainly under the level: read only is still trust.
    await expect(levelRow).toContainText('Read only still means trust: a Session transcript can show a secret')
    await expect(levelRow).toContainText('not Terminal output')
    await evidence18(b.window, 'settings-machines-read-only')
    await expect.poll(() => savedLinkSettings(bData)).toStrictEqual({ version: 2, projectsAccess: true, machines: { [aId]: 'read' }, keepAwake: true, tailscale: false })
    await closeSettings(b.window)

    // On A: the Project of B is listed; reading answers, a change is refused with the read-only text.
    await expect(projectRow(a.window, bId, 'beta-repo-0000000b')).toContainText('beta-repo')
    expect(await invokeOnB('layout.get', { projectId: 'beta-repo-0000000b' })).toMatchObject({ ok: true, value: { ok: true } })
    const node = { op: 'create', node: { id: 'from-a', kind: 'note', x: 0, y: 0, w: 220, h: 120, data: { text: 'from A' } } }
    const refused = await invokeOnB('layout.apply', { projectId: 'beta-repo-0000000b', op: node })
    expect(refused).toMatchObject({ ok: true, value: { ok: false, error: expect.stringMatching(/^Linked machines can only view the Projects of .+: access is read-only$/) } })

    // Full access: the same change goes through.
    const again = await openMachinesSettings(b)
    await chooseLevel(b.window, again.getByTestId(`link-machine-access-${aId}`), 'all')
    await evidence18(b.window, 'settings-machines-full-access')
    await closeSettings(b.window)
    await expect.poll(async () => ((await invokeOnB('layout.apply', { projectId: 'beta-repo-0000000b', op: node })) as { value?: { ok?: boolean } }).value?.ok).toBe(true)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('A opens a Project of B: its Canvas, Node moves, Session, Terminal and Autopilot go to B; B gone — "unreachable", B back — the Canvas again', async () => {
  test.setTimeout(240_000)
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-canvas-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const own = gitRepo(join(scratch, 'alpha'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: 'alpha-0000000a', name: 'alpha', path: own }])
  const bSetup = prepareB(scratch, shared)
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    const bWindow = b.window
    await stubPower(b.app)
    await canvasReady(b, { size: SIZE })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, bWindow)
    const bId = await machineIdOf(bWindow)
    await setProjectsAccess(b, true)

    // A opens beta of B: the window loads again, on B, and shows B's Layout.
    await projectRow(a.window, bId, BETA).getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    const noteInA = a.window.locator('[data-testid="note-node"][data-node-id="note-b"]')
    await expect(noteInA).toContainText('A note of B')
    // The toolbar names the Machine next to the Project; the row of beta is the one selected.
    await expect(a.window.locator('.w-toolbar__name')).toContainText('beta · ')
    await expect(projectRow(a.window, bId, BETA).getByRole('button')).toHaveAttribute('aria-current', 'true')
    // B's own screen keeps its own active Project.
    await expect(bWindow.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    await canvasReady(a)
    await evidence(a.window, 'canvas-of-b')

    // Autopilot started and stopped from A: B runs it, both windows show it. First, while every
    // camera is still where the Layout opens it, so the Epic frame is in view.
    const frame = (window: Page) => window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
    await frame(a.window).getByTestId('action-autopilot').click()
    for (const window of [a.window, bWindow]) await expect(frame(window).getByTestId('autopilot-status')).toHaveText('Wave 1 · running', { timeout: 20_000 })
    await frame(a.window).getByTestId('action-autopilot-more').click()
    await a.window.getByTestId('action-force-stop-autopilot').click()
    for (const window of [a.window, bWindow]) await expect(frame(window).getByTestId('autopilot-status')).toHaveText('stopped: user force stop', { timeout: 20_000 })

    // A Node moved in A is in the same place in B's window within a second.
    const before = await drawnAt(bWindow, 'note-b')
    await drag(a, noteInA.locator('.w-note__header'), 160, 90)
    await expect.poll(() => drawnAt(a.window, 'note-b')).not.toBe(before)
    const moved = await drawnAt(a.window, 'note-b')
    await expect.poll(() => drawnAt(bWindow, 'note-b'), { timeout: 1_000 }).toBe(moved)

    // What A types into the Terminal runs in B's shell, and its output is in B's window. Before the
    // Session below: a new Session moves the camera to itself, and at 1400×900 that leaves the
    // Terminal past the right edge of the window.
    const termA = a.window.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    const termB = bWindow.locator('.react-flow__node[data-id="term"]').getByTestId('terminal-node')
    await expect(termA).toHaveAttribute('data-state', 'running', { timeout: 15_000 })
    await expect(termA.getByTestId('terminal-screen')).toBeInViewport({ ratio: 1 })
    await termA.getByTestId('terminal-screen').click()
    await a.window.keyboard.type('echo from""-a-$((6*7))')
    await a.window.keyboard.press('Enter')
    await expect.poll(() => screenText(termB), { timeout: 10_000 }).toMatch(/^from-a-42$/m)

    // A Session started in A runs on B and is live in B's window.
    const live = (window: Page) => window.locator('[data-testid="session-node"][data-live="true"]')
    await a.window.getByTestId('sidebar-new-session').click()
    await expect(live(a.window)).toHaveCount(1)
    const sessionNode = await live(a.window).getAttribute('data-node-id')
    await expect(bWindow.locator(`[data-testid="session-node"][data-live="true"][data-node-id="${sessionNode}"]`)).toHaveCount(1)
    await expect(bWindow.locator(`[data-testid="session-node"][data-live="true"][data-node-id="${sessionNode}"]`).getByTestId('session-node-status')).toHaveText('idle')

    // B quits while A shows its Project: a line over the Canvas, the window stays.
    await b.close()
    b = undefined
    await expect(a.window.getByTestId('linked-machine-notice')).toHaveText(/ is unreachable$/, { timeout: 20_000 })
    await expect(a.window.getByTestId('canvas')).toBeVisible()
    await evidence(a.window, 'canvas-unreachable')

    // B starts again over the same data folder: A loads again and shows B's Layout.
    b = await launchApp({ env: bSetup.env })
    await expect(a.window.getByTestId('linked-machine-notice')).toHaveCount(0, { timeout: 60_000 })
    await expect(a.window.getByTestId('canvas')).toHaveAttribute('data-project-id', BETA)
    // B's Layout again, with the Session Node A made and the Node where A left it. The camera is the
    // one this window saved for B's Project (worfy-link ticket 09), so a Node may lie off screen:
    // its place is read from B's Layout.
    await expect(a.window.locator(`[data-testid="session-node"][data-node-id="${sessionNode}"]`)).toBeVisible()
    const layoutOfB = await call<{ ok: boolean; value: { layout: { nodes: { id: string; x: number; y: number }[] } } }>(a.window, 'linked.invoke', {
      machine: bId,
      channel: 'layout.get',
      input: { projectId: BETA },
    })
    const note = layoutOfB.value.layout.nodes.find((node) => node.id === 'note-b')
    const [movedX, movedY] = (moved.match(/-?[\d.]+/g) ?? []).map(Number)
    expect(note).toBeDefined()
    expect(Math.abs((note?.x ?? NaN) - (movedX ?? NaN))).toBeLessThan(1)
    expect(Math.abs((note?.y ?? NaN) - (movedY ?? NaN))).toBeLessThan(1)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('one folder in A and in B is two Projects: moving a Node in B\'s does not move A\'s; B keeps its active Project and opens the Orchestrator', async () => {
  test.setTimeout(180_000)
  const scratch = realpathSync(await mkdtemp(join(tmpdir(), 'worfy-link-09-shared-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const aData = dataFolder(join(scratch, 'a-data'), [{ id: SHARED, name: 'shared', path: shared }])
  const bSetup = prepareB(scratch, shared)
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  // The same Node id in both Layouts of the folder, at the same place.
  for (const dataDir of [aData, bSetup.dataDir]) {
    mkdirSync(join(dataDir, SHARED), { recursive: true })
    writeFileSync(
      join(dataDir, SHARED, 'layout.json'),
      JSON.stringify({ nodes: [{ id: 'note-s', kind: 'note', x: 700, y: 80, w: 220, h: 120, ...base, data: { text: 'shared note' } }], viewport: { x: 0, y: 0, zoom: 0.8 } }),
    )
  }
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: bSetup.env })
    await canvasReady(a, { size: SIZE })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setProjectsAccess(b, true)
    const activeOfB = (): string | null => (JSON.parse(readFileSync(join(bSetup.dataDir, 'projects.json'), 'utf8')) as { activeId: string | null }).activeId

    // Two rows with one id, one per Machine.
    await expect(a.window.locator(`[data-testid="project-row"][data-project-id="${SHARED}"]`)).toHaveCount(2)
    await expect(projectRow(a.window, bId, SHARED)).toBeVisible()
    const ownLayout = await call<{ layout: { nodes: { id: string; x: number; y: number }[] } }>(a.window, 'layout.get', { projectId: SHARED })

    await projectRow(a.window, bId, SHARED).getByRole('button').click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const note = a.window.locator('[data-testid="note-node"][data-node-id="note-s"]')
    await expect(note).toBeVisible()
    await drag(a, note.locator('.w-note__header'), 200, 120)
    const layoutOfB = () => call<{ ok: boolean; value: { layout: { nodes: { id: string; kind: string; x: number; y: number }[] } } }>(a.window, 'linked.invoke', { machine: bId, channel: 'layout.get', input: { projectId: SHARED } })
    await expect.poll(async () => (await layoutOfB()).value.layout.nodes.find((node) => node.id === 'note-s')?.x).toBeGreaterThan(750)
    // A's own Project of the same folder: not moved.
    const ownAfter = await call<{ layout: { nodes: { id: string; x: number; y: number }[] } }>(a.window, 'layout.get', { projectId: SHARED })
    expect(ownAfter.layout.nodes.find((node) => node.id === 'note-s')).toMatchObject({ x: ownLayout.layout.nodes.find((node) => node.id === 'note-s')?.x, y: 80 })
    // B's active Project is still its own choice, and B opened the Orchestrator of the one A shows.
    expect(activeOfB()).toBe(BETA)
    await expect.poll(async () => (await layoutOfB()).value.layout.nodes.filter((node) => node.kind === 'orchestrator').length, { timeout: 15_000 }).toBe(1)
    const opened = await call<{ ok: boolean; value: { sessionId: string | null } | null }>(a.window, 'linked.invoke', { machine: bId, channel: 'orchestrator.view', input: { nodeId: (await layoutOfB()).value.layout.nodes.find((node) => node.kind === 'orchestrator')?.id ?? '' } })
    expect(opened.ok).toBe(true)
    expect(activeOfB()).toBe(BETA)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
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
