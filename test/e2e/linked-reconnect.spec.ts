// Reconnect, Remove and Change address… of a Linked machine without a connection (worfy-link ticket
// 37), on two built worfy linked through the UI over 127.0.0.1 (Bonjour is off, launchApp). Each
// worfy has its own data folder, kept across a restart so the restarted one is the same Machine.
//
// The link files are edited only while that worfy is closed: link/machine.json keeps the port its
// server listens on, link/linked.json the address and port of each Linked machine. Moving B's port
// and pointing B's record of A at a port where nothing listens leaves A as the only side that can
// dial: whatever brings the link back then comes from A.
import { readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { expandMachines, launchApp, linkThroughUi, machineIdOf, openLinkDialog, type LaunchedApp } from './helpers'

const row = (window: Page, machineId: string): Locator => window.locator(`[data-testid="machine-row"][data-machine-id="${machineId}"]`)

/** A port nothing listens on: the OS gives a free one, and it is closed again at once. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (typeof address === 'object' && address !== null ? resolve(address.port) : reject(new Error('no port'))))
    })
  })
}

const machineFile = (dataDir: string): string => join(dataDir, 'link', 'machine.json')
const linkedFile = (dataDir: string): string => join(dataDir, 'link', 'linked.json')

/** The port the server of the worfy over `dataDir` listens on (link/machine.json). */
function portOf(dataDir: string): number {
  const port = (JSON.parse(readFileSync(machineFile(dataDir), 'utf8')) as { port: number | null }).port
  if (port === null) throw new Error(`${dataDir}: no port in link/machine.json`)
  return port
}

function editJson(file: string, edit: (data: Record<string, unknown>) => void): void {
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  edit(data)
  writeFileSync(file, JSON.stringify(data))
}

/** In the closed worfy over `dataDir`: its record of Machine `id` points at `port`, and keeps no name to try instead. */
function pointRecordAt(dataDir: string, id: string, port: number): void {
  editJson(linkedFile(dataDir), (data) => {
    for (const record of data.machines as Record<string, unknown>[]) {
      if (record.id !== id) continue
      record.port = port
      delete record.localName
      delete record.tailnetName
    }
  })
}

interface Pair {
  a: LaunchedApp
  b: LaunchedApp | undefined
  aDir: string
  bDir: string
  aId: string
  bId: string
}

/** Two worfy over their own data folders, linked through the UI; B is closed by the caller. */
async function linkedPair(): Promise<Pair> {
  const aDir = await mkdtemp(join(tmpdir(), 'worfy-link-reconnect-a-'))
  const bDir = await mkdtemp(join(tmpdir(), 'worfy-link-reconnect-b-'))
  const a = await launchApp({ env: { WORFY_DATA_DIR: aDir } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bDir } })
    await linkThroughUi(a.window, b.window)
    return { a, b, aDir, bDir, aId: await machineIdOf(a.window), bId: await machineIdOf(b.window) }
  } catch (error) {
    await a.close()
    await b?.close()
    throw error
  }
}

async function closePair(pair: Pair | undefined): Promise<void> {
  if (pair === undefined) return
  await pair.a.close()
  await pair.b?.close()
  for (const dir of [pair.aDir, pair.bDir]) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

/** Closes B and waits until A shows it Offline, with the buttons of a row without a connection. */
async function closeB(pair: Pair): Promise<void> {
  await pair.b?.close()
  pair.b = undefined
  await expandMachines(pair.a.window)
  const bRow = row(pair.a.window, pair.bId)
  await expect(bRow).toHaveAttribute('data-state', 'unavailable', { timeout: 20_000 })
  await expect(bRow).toContainText('Offline')
  for (const testId of ['machine-reconnect', 'machine-change-address', 'machine-remove']) await expect(bRow.getByTestId(testId)).toBeVisible()
}

test('Remove from the row of an offline Machine: gone here at once, and on the other side after its next dial', async () => {
  test.setTimeout(150_000)
  let pair: Pair | undefined
  try {
    pair = await linkedPair()
    await closeB(pair)
    const { a, aId, bId, bDir } = pair

    // Cancel first: nothing is removed.
    await row(a.window, bId).getByTestId('machine-remove').click()
    const confirm = a.window.getByRole('dialog', { name: /^Remove .+\?$/ })
    await expect(confirm).toContainText('will be forgotten here now')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(row(a.window, bId)).toBeVisible()

    await row(a.window, bId).getByTestId('machine-remove').click()
    await a.window.getByRole('dialog', { name: /^Remove .+\?$/ }).getByRole('button', { name: 'Remove' }).click()
    await expect(row(a.window, bId)).toHaveCount(0)

    // With no Linked machine left, A's link server stops listening (service.ts, the reason `linked`);
    // "Link a machine" makes it listen again, as when the user links anew. B comes back with A still
    // on its list; its first dial is refused and it forgets A.
    await openLinkDialog(a.window)
    pair.b = await launchApp({ env: { WORFY_DATA_DIR: bDir } })
    await expandMachines(pair.b.window)
    await expect(row(pair.b.window, aId)).toHaveCount(0, { timeout: 30_000 })
    // And A did not get B back.
    await expect(row(a.window, bId)).toHaveCount(0)
  } finally {
    await closePair(pair)
  }
})

test('Reconnect dials at once: the link is back without waiting for the pause between retries', async () => {
  test.setTimeout(180_000)
  let pair: Pair | undefined
  try {
    pair = await linkedPair()
    const { aId, bId, bDir } = pair
    await closeB(pair)
    const closedAt = Date.now()
    // B cannot dial A when it is back: its record of A points where nothing listens. B keeps its port.
    pointRecordAt(bDir, aId, await freePort())

    // A's retries come 1, 2, 4, 8, 16 and 30 s apart: past 32 s the next one is about 30 s away.
    await pair.a.window.waitForTimeout(Math.max(0, closedAt + 34_000 - Date.now()))
    pair.b = await launchApp({ env: { WORFY_DATA_DIR: bDir } })
    await machineIdOf(pair.b.window)
    const clickedAfter = Date.now() - closedAt
    expect(clickedAfter, 'B started too slowly: a retry of A might bring the link back by itself').toBeLessThan(52_000)

    const reconnect = row(pair.a.window, bId).getByTestId('machine-reconnect')
    await reconnect.click()
    await expect(row(pair.a.window, bId)).toHaveAttribute('data-state', 'online', { timeout: 6_000 })
    expect(Date.now() - closedAt, 'online before the next retry of A was due').toBeLessThan(60_000)
    await expandMachines(pair.b.window)
    await expect(row(pair.b.window, aId)).toHaveAttribute('data-state', 'online')
    await expect(row(pair.a.window, bId).getByTestId('machine-reconnect')).toHaveCount(0)
  } finally {
    await closePair(pair)
  }
})

test('Change address…: another worfy at the address is refused in the window; the right address brings the link back', async () => {
  test.setTimeout(150_000)
  let pair: Pair | undefined
  try {
    pair = await linkedPair()
    const { a, aDir, aId, bId, bDir } = pair
    await closeB(pair)
    // B comes back on another port, and cannot dial A: only A, told the new address, can reach it.
    const newPort = await freePort()
    editJson(machineFile(bDir), (data) => {
      data.port = newPort
    })
    pointRecordAt(bDir, aId, await freePort())
    pair.b = await launchApp({ env: { WORFY_DATA_DIR: bDir } })
    await machineIdOf(pair.b.window)
    expect(portOf(bDir)).toBe(newPort)

    await row(a.window, bId).getByTestId('machine-change-address').click()
    const dialog = a.window.getByRole('dialog', { name: /^Change address of / })
    await expect(dialog).toBeVisible()
    // A's own server answers there: another certificate.
    await dialog.getByTestId('change-address-input').fill(`127.0.0.1:${portOf(aDir)}`)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible({ timeout: 20_000 })
    await expect(dialog).toBeVisible()
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'unavailable')

    await dialog.getByTestId('change-address-input').fill(`127.0.0.1:${newPort}`)
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toHaveCount(0, { timeout: 20_000 })
    await expect(row(a.window, bId)).toHaveAttribute('data-state', 'online', { timeout: 20_000 })
    await expandMachines(pair.b.window)
    await expect(row(pair.b.window, aId)).toHaveAttribute('data-state', 'online')
  } finally {
    await closePair(pair)
  }
})
