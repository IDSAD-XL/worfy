import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

// Browser profiles (worfy-browser ticket 03, ADR-0078 item 5). One profile's cookies are shared by
// all its Browsers and seen by no Browser of another profile, and they survive a restart: each
// profile has its own persist: partition. The user makes «admin» in the window «Browser profiles…»,
// opened from the profile's name in a frame's header; two Browsers whose profile is gone show
// «Choose a profile» and are put under «admin» there; a Browser opened before profiles existed (a
// page address, no profile) stays on «Default». With two profiles, «New browser» asks in its frame.
// The pages are served by a server this file starts on 127.0.0.1: no outside site. With
// WORFY_EVIDENCE_DIR set, the snapshots are copied there as 03-browser-profile-<theme>.png.

const PROJECT = 'browser-0000000c'
const WINDOW = { width: 1400, height: 900 }

let server: Server
let origin: string
let scratch: string
let launched: LaunchedApp | undefined

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

/** git for the fixture, without GIT_* variables of a surrounding hook. */
function git(cwd: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env })
}

test.beforeAll(async () => {
  // Every path is a page with the fixture's cream background that says when it is ready.
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>page</title><body style="margin:0;background:#fdf6e3" data-ready="yes">a page</body>')
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()))
})

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-browser-profile-')))
})

test.afterEach(async () => {
  await launched?.close()
  launched = undefined
  await removeDir(scratch)
})

const dataDir = (): string => join(scratch, 'data')
const repo = (): string => join(scratch, 'alpha')

/** Writes a Project whose Layout holds `nodes`, at zoom 1; no Browser profile yet. */
function project(nodes: Record<string, unknown>[]): void {
  mkdirSync(join(scratch, 'home'))
  mkdirSync(repo())
  git(repo(), 'init', '-q')
  const base = { hidden: false, locked: false, pinned: false, tags: [] }
  mkdirSync(join(dataDir(), PROJECT), { recursive: true })
  writeFileSync(join(dataDir(), 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'alpha', path: repo() }], activeId: PROJECT }))
  writeFileSync(join(dataDir(), PROJECT, 'layout.json'), JSON.stringify({ nodes: nodes.map((node) => ({ ...base, ...node })), viewport: { x: 0, y: 0, zoom: 1 } }))
}

async function start(): Promise<Page> {
  launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir(), HOME: join(scratch, 'home') } })
  await canvasReady(launched, { size: WINDOW })
  return launched.window
}

/** The `data` of each Browser Node main saved, by id. */
function savedBrowsers(): Record<string, { url?: string; profile?: string }> {
  const file = join(dataDir(), PROJECT, 'layout.json')
  if (!existsSync(file)) return {}
  const layout = JSON.parse(readFileSync(file, 'utf8')) as { nodes: { id: string; kind: string; data: { url?: string; profile?: string } }[] }
  return Object.fromEntries(layout.nodes.filter((node) => node.kind === 'browser').map((node) => [node.id, node.data]))
}

/** The profiles main saved in the Project's data folder. */
function savedProfiles(): { id: string; name: string }[] {
  const file = join(dataDir(), PROJECT, 'browser-profiles.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { profiles: { id: string; name: string }[] }).profiles : []
}

/** The Browser pages as [address, ready, partition], read in main; sorted by address. */
async function pages(): Promise<[string, string | undefined, string][]> {
  if (launched === undefined) return []
  const all = await launched.app.evaluate(async ({ webContents }) => {
    const guests = webContents.getAllWebContents().filter((contents) => contents.getType() === 'webview' && !contents.isDestroyed())
    return Promise.all(
      guests.map(async (contents) => [contents.getURL(), (await contents.executeJavaScript('document.body?.dataset.ready')) as string | undefined, contents.session.storagePath ?? ''] as [string, string | undefined, string]),
    )
  })
  return all.sort((a, b) => a[0].localeCompare(b[0]))
}

/** Runs `code` in the one Browser page at `url`. */
async function inGuest(url: string, code: string): Promise<unknown> {
  return launched!.app.evaluate(
    async ({ webContents }, { url, code }) => {
      const guest = webContents.getAllWebContents().find((contents) => contents.getType() === 'webview' && contents.getURL() === url)
      if (!guest) throw new Error(`no Browser page at ${url}`)
      return guest.executeJavaScript(code, true)
    },
    { url, code },
  )
}

/** Copies a PNG into WORFY_EVIDENCE_DIR as <name>.png, when the variable is set. */
function evidence(file: string, name: string): void {
  const dir = process.env.WORFY_EVIDENCE_DIR
  if (dir === undefined || dir === '') return
  mkdirSync(dir, { recursive: true })
  copyFileSync(file, join(dir, `${name}.png`))
}

test('a cookie of one Browser profile is seen by its other Browser, not by a Browser of another profile, and stays after a restart', async () => {
  const [old, one, two] = [`${origin}/old`, `${origin}/one`, `${origin}/two`]
  project([
    // Opened before profiles existed: a page address and no profile.
    { id: 'b0', kind: 'browser', x: 600, y: 20, w: 300, h: 240, data: { url: old } },
    // Two Browsers of a profile that is gone.
    { id: 'b1', kind: 'browser', x: 920, y: 20, w: 300, h: 240, data: { profile: 'gone-000000' } },
    { id: 'b2', kind: 'browser', x: 920, y: 280, w: 300, h: 240, data: { profile: 'gone-000000' } },
  ])
  let window = await start()
  const frame = (id: string) => window.locator(`[data-testid="browser-frame"][data-node-id="${id}"]`)

  // The first read made «Default»; the old Browser stays on it, and the Node keeps it from now on.
  await expect(frame('b0').getByTestId('browser-profile-name')).toHaveText('Default')
  await expect.poll(() => savedProfiles().map((profile) => profile.id)).toEqual(['default'])
  await expect.poll(() => savedBrowsers().b0?.profile, { message: 'the old Browser keeps Default' }).toBe('default')
  await expect.poll(pages, { timeout: 15_000 }).toEqual([[old, 'yes', expect.stringContaining('worfy-browser-0000000c-default')]])
  // The Browsers of the gone profile show an empty frame with «Choose a profile» and open no page.
  await expect(frame('b1').getByTestId('browser-choose-profile')).toContainText('was deleted')
  await expect(frame('b2').getByTestId('browser-choose-profile-button')).toBeVisible()

  // «Browser profiles…» from the profile's name: make «admin».
  await frame('b0').getByTestId('browser-profile-name').click()
  const profiles = window.getByTestId('browser-profiles')
  await expect(profiles).toBeVisible()
  await profiles.getByTestId('browser-profiles-new-name').fill('admin')
  await profiles.getByTestId('browser-profiles-create').click()
  await expect(profiles.getByTestId('browser-profile-row')).toHaveCount(2)
  await expect(profiles.getByTestId('browser-profile-name-input')).toHaveValue('admin')
  await profiles.getByTestId('browser-profile-origins').fill(`${origin}\nhttps://staging.example.com`)
  await expect(profiles.getByTestId('browser-profile-origins-error')).toHaveCount(0)
  await profiles.getByRole('button', { name: 'Save' }).click()
  await expect.poll(() => savedProfiles().map((profile) => profile.name)).toEqual(['Default', 'admin'])
  const admin = savedProfiles()[1]!.id
  const shots = await snapshotThemes(window, 'browser-profile')
  evidence(shots.light, '03-browser-profile-light')
  evidence(shots.dark, '03-browser-profile-dark')
  await profiles.getByTestId('browser-profiles-close').click()
  await expect(profiles).toHaveCount(0)

  // Both Browsers of the gone profile go under «admin», each to its own page.
  for (const [id, url] of [
    ['b1', one],
    ['b2', two],
  ] as const) {
    await frame(id).getByTestId('browser-choose-profile-button').click()
    await window.getByRole('menuitem', { name: 'admin' }).click()
    await expect(frame(id).getByTestId('browser-profile-name')).toHaveText('admin')
    const address = frame(id).getByTestId('browser-address')
    await address.click()
    await address.fill(url)
    await address.press('Enter')
  }
  await expect.poll(() => [savedBrowsers().b1?.profile, savedBrowsers().b2?.profile]).toEqual([admin, admin])
  await expect
    .poll(pages, { timeout: 15_000, message: 'three pages, two on the partition of admin' })
    .toEqual([
      [old, 'yes', expect.stringContaining('worfy-browser-0000000c-default')],
      [one, 'yes', expect.stringContaining(`worfy-browser-0000000c-${admin}`)],
      [two, 'yes', expect.stringContaining(`worfy-browser-0000000c-${admin}`)],
    ])

  // A cookie set in one Browser of admin: the other Browser of admin sees it, the Browser of Default does not.
  await inGuest(one, "document.cookie = 'who=admin; max-age=86400; path=/'")
  await expect.poll(() => inGuest(two, 'document.cookie'), { message: 'the other Browser of admin' }).toContain('who=admin')
  expect(await inGuest(old, 'document.cookie'), 'the Browser of Default').not.toContain('who=admin')

  // With two profiles, «New browser» asks in its frame.
  await window.mouse.click(560, 300, { button: 'right' })
  await window.getByRole('menuitem', { name: 'New browser' }).click()
  await expect(window.getByTestId('browser-choose-profile')).toHaveCount(1)
  await expect(window.getByTestId('browser-choose-profile')).toContainText('no Browser profile yet')

  // After a restart the cookie is there for admin, and still not for Default.
  await launched!.close()
  launched = undefined
  window = await start()
  await expect.poll(pages, { timeout: 15_000, message: 'the pages after the restart' }).toEqual([
    [old, 'yes', expect.stringContaining('-default')],
    [one, 'yes', expect.stringContaining(admin)],
    [two, 'yes', expect.stringContaining(admin)],
  ])
  expect(await inGuest(two, 'document.cookie')).toContain('who=admin')
  expect(await inGuest(old, 'document.cookie')).not.toContain('who=admin')
  // The profiles are in the data folder, none in the repository.
  expect(existsSync(join(repo(), 'browser-profiles.json'))).toBe(false)
})

test('deleting a profile names the Browsers that use it, erases its cookies, and its Browsers ask for another profile', async () => {
  const page = `${origin}/page`
  project([{ id: 'b0', kind: 'browser', x: 600, y: 20, w: 360, h: 280, data: { url: page } }])
  const window = await start()
  const frame = window.locator('[data-testid="browser-frame"][data-node-id="b0"]')
  await expect.poll(pages, { timeout: 15_000 }).toEqual([[page, 'yes', expect.stringContaining('-default')]])
  await inGuest(page, "document.cookie = 'kept=yes; max-age=86400; path=/'")

  await frame.getByTestId('browser-profile-name').click()
  const profiles = window.getByTestId('browser-profiles')
  await profiles.getByTestId('browser-profile-delete').click()
  await expect(profiles.getByTestId('browser-profile-delete-usage')).toHaveText('1 Browser on this Canvas uses it and will ask for another profile.')
  await profiles.getByTestId('browser-profile-delete-confirm').click()
  await expect.poll(savedProfiles).toEqual([])
  await profiles.getByTestId('browser-profiles-close').click()

  // The Browser shows «Choose a profile» and its page is gone.
  await expect(frame.getByTestId('browser-choose-profile')).toContainText('was deleted')
  await expect.poll(pages).toEqual([])
  // The partition's cookies are erased: read in main from the session itself.
  const cookies = await launched!.app.evaluate(async ({ session }, partition) => (await session.fromPartition(partition).cookies.get({})).map((cookie) => cookie.name), 'persist:worfy-browser-0000000c-default')
  expect(cookies).toEqual([])
})
