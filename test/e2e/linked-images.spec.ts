// Images on the Canvas of a Linked machine (worfy-canvas ticket 24) on two built worfy. A and B are
// linked and both list one folder as a Project; the Canvas of B holds an image Node whose file is in
// B's data folder only, one whose file is gone and one whose file is over 20 MB. A opens the Project
// of B: the image comes from B over the link (worfy-image://canvas.<project label>.<machine label of
// B>/<file>) and shows whole, with its proportions; the other two show a plate that says why. On A
// the image of B is only shown: selected, it has no resize handles, and Delete leaves it and its file
// on B where they are. Bonjour is off and the link server listens on loopback only (launchApp).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { expect, test, type Page } from '@playwright/test'
import { decodePng } from './browser-pixels'
import { launchApp, linkThroughUi, machineIdOf, repoRoot, setProjectsAccess, type LaunchedApp } from './helpers'
import { snapshotThemes } from './snapshots'

test.setTimeout(180_000)

const SHARED = 'shared-0000024c'
const LABEL = '0000024c'
const PICTURE = `${'a'.repeat(32)}.png`
const GONE = `${'b'.repeat(32)}.png`
const BIG = `${'c'.repeat(32)}.png`
/** The image on B: a red rectangle twice as wide as it is high. */
const NATURAL = { width: 400, height: 200 }

/** Where the snapshots of this ticket are kept in the repository (rules: .scratch/<epic>/evidence/NN-what.png). */
const EVIDENCE = join(repoRoot, '.scratch', 'worfy-canvas', 'evidence')

/**
 * Takes the light and dark snapshot of `window` (test-results/e2e/snapshots/24-<name>/). With
 * WORFY_EVIDENCE=1 both are also kept as the ticket's evidence `24-<name>-{light,dark}.png`; an
 * ordinary run leaves the repository's files alone.
 */
async function evidence(window: Page, name: string): Promise<void> {
  const shots = await snapshotThemes(window, `24-${name}`)
  if (process.env.WORFY_EVIDENCE !== '1') return
  await mkdir(EVIDENCE, { recursive: true })
  await copyFile(shots.light, join(EVIDENCE, `24-${name}-light.png`))
  await copyFile(shots.dark, join(EVIDENCE, `24-${name}-dark.png`))
}

/** A red PNG of `width` × `height`. */
function redPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc32(body))
    return Buffer.concat([head, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([255, 0, 0]))])
  const rows = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const BASE = { hidden: false, locked: false, pinned: false, tags: [] }

/** An image Node at (x, y), `w` × `h` on the Canvas; the image itself is NATURAL. */
function imageNode(id: string, file: string, x: number, y: number, w = NATURAL.width, h = NATURAL.height) {
  return { id, kind: 'image', x, y, w, h, ...BASE, data: { file, ...NATURAL, mime: 'image/png' } }
}

/** A data folder that lists the one shared folder as Project SHARED, with `nodes` on its Canvas. */
function dataFolder(path: string, shared: string, nodes: unknown[]): string {
  mkdirSync(join(path, SHARED, 'images'), { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects: [{ id: SHARED, name: 'shared', path: shared }], activeId: SHARED }))
  writeFileSync(join(path, SHARED, 'layout.json'), JSON.stringify({ nodes, viewport: { x: 0, y: 0, zoom: 1 } }))
  return path
}

/** A folder with a committed git repository on branch main. */
function gitRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: path, env: gitEnv })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(path, 'README.md'), '# shared\n')
  git('add', '.')
  git('commit', '-q', '-m', 'init')
  return realpathSync.native(path)
}

const projectButton = (window: Page, machineId: string) =>
  window.locator(`[data-testid="machine-group"][data-machine-id="${machineId}"] [data-testid="project-row"][data-project-id="${SHARED}"]`).getByRole('button')

/** How long the first image of B may take in A's window: A's window loads again on B, then A's protocol asks B for the file (as FIRST_FRAME_MS of linked-cards.spec.ts). */
const FIRST_IMAGE_MS = 15_000

/** The red part of a capture of the Node: where the image's own pixels are. */
async function redBox(window: Page, nodeId: string): Promise<{ width: number; height: number; card: { width: number; height: number } }> {
  const image = decodePng(await window.locator(`[data-testid="image-node"][data-node-id="${nodeId}"]`).screenshot())
  let [left, top, right, bottom] = [image.width, image.height, -1, -1]
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const at = (y * image.width + x) * 4
      if (image.data[at]! > 200 && image.data[at + 1]! < 70 && image.data[at + 2]! < 70) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < 0) throw new Error('no red pixel in the Node')
  return { width: right - left + 1, height: bottom - top + 1, card: { width: image.width, height: image.height } }
}

test('A shows the image of B from B, undistorted and only to look at; a missing and a too large image of B say why', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-canvas-24-images-')))
  const shared = gitRepo(join(scratch, 'shared'))
  const aData = dataFolder(join(scratch, 'a-data'), shared, [])
  const bData = dataFolder(join(scratch, 'b-data'), shared, [
    // The image first: a Delete of the selection goes through it before the note.
    imageNode('pic', PICTURE, 40, 120),
    imageNode('gone', GONE, 480, 120, 260, 130),
    { id: 'note', kind: 'note', x: 780, y: 120, w: 200, h: 100, ...BASE, data: { text: 'A note of B' } },
    imageNode('big', BIG, 480, 360),
  ])
  const imagesOfB = join(bData, SHARED, 'images')
  writeFileSync(join(imagesOfB, PICTURE), redPng(NATURAL.width, NATURAL.height))
  // Over the 20 MB limit: B answers too-large and sends none of it.
  writeFileSync(join(imagesOfB, BIG), Buffer.alloc(20 * 1024 * 1024 + 1))
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData } })
  let b: LaunchedApp | undefined
  try {
    b = await launchApp({ env: { WORFY_DATA_DIR: bData } })
    await linkThroughUi(a.window, b.window)
    const bId = await machineIdOf(b.window)
    await setProjectsAccess(b, true)

    // A's own Project has no image: the file of B is in B's data folder only.
    await expect(a.window.getByTestId('image-node')).toHaveCount(0)
    expect(existsSync(join(aData, SHARED, 'images', PICTURE))).toBe(false)

    await projectButton(a.window, bId).click()
    await expect(a.window).toHaveURL(new RegExp(`[?&]machine=${bId}`))
    const node = a.window.locator('[data-testid="image-node"][data-node-id="pic"]')
    const picture = node.getByRole('img', { name: 'Image' })
    const src = await picture.getAttribute('src', { timeout: FIRST_IMAGE_MS })
    expect(src).toMatch(new RegExp(`^worfy-image://canvas\\.${LABEL}\\.[0-9a-f]{32}/${PICTURE}$`))
    await expect(picture).toHaveJSProperty('complete', true, { timeout: FIRST_IMAGE_MS })
    await expect(picture).toHaveJSProperty('naturalWidth', NATURAL.width)
    await expect(picture).toHaveJSProperty('naturalHeight', NATURAL.height)
    // On screen: whole, with the natural proportions, filling the card (less its border) it has the proportions of.
    const red = await redBox(a.window, 'pic')
    expect(Math.abs(red.width / red.height - NATURAL.width / NATURAL.height), `the image is ${red.width} × ${red.height} on screen`).toBeLessThan(0.08)
    expect(red.width / red.card.width, `the image is ${red.width} px wide in a ${red.card.width} px capture`).toBeGreaterThan(0.95)

    // The other two say why, instead of a broken image.
    await expect(a.window.locator('[data-node-id="gone"]').getByRole('img', { name: 'Image not available' })).toBeVisible({ timeout: FIRST_IMAGE_MS })
    await expect(a.window.locator('[data-node-id="big"]').getByRole('img', { name: 'Image too large' })).toBeVisible({ timeout: FIRST_IMAGE_MS })

    // Selected, the image of B has no resize handles.
    await node.click()
    await expect(a.window.locator('.react-flow__node.selected [data-node-id="pic"]')).toHaveCount(1)
    await expect(a.window.locator('.react-flow__resize-control')).toHaveCount(0)
    await evidence(a.window, 'image-of-linked-machine')

    // Delete of the image with a note of B: the note goes to B's trash — the sign that the key was
    // handled and its trash calls answered, the image's first — and the image stays, its file on B too.
    await a.window.locator('.react-flow__node[data-id="note"] .w-note__header').click({ modifiers: ['ControlOrMeta'] })
    await expect(a.window.locator('.react-flow__node.selected')).toHaveCount(2)
    await a.window.keyboard.press('Delete')
    await expect(a.window.locator('.react-flow__node[data-id="note"]')).toHaveCount(0)
    await expect(b.window.locator('.react-flow__node[data-id="note"]')).toHaveCount(0)
    await expect(node).toHaveCount(1)
    await expect(node.getByRole('img', { name: 'Image' })).toBeVisible()
    expect(existsSync(join(imagesOfB, PICTURE))).toBe(true)
    await expect(b.window.locator('[data-testid="image-node"][data-node-id="pic"]')).toHaveCount(1)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
