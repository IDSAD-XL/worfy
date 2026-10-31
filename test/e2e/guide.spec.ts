import { copyFile, mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchApp, repoRoot } from './helpers'
import { clickMenuItem } from './menu'
import { snapshotThemes } from './snapshots'

// worfy-guide ticket 03 (ADR-0090): the worfy Guide against the built app, with no Project and no
// network. Nothing opens it at the start; Help ▸ worfy Guide — clicked by its id (clickMenuItem) —
// and the Command palette open it, Esc closes it; the EN / RU switch changes the text and the choice
// outlives a restart of the app. Its window is a chunk of its own: the start does not fetch it, the
// first opening does. Snapshots in both themes and both languages: test-results/e2e/snapshots/guide-*/
// (test/e2e/snapshots.ts); with WORFY_EVIDENCE_DIR set they are copied there as
// 03-guide-<language>-<theme>.png. No pixel comparison (the epic's spec, Q21).

/** GUIDE_MENU_ITEM_ID of src/main/menu.ts; that module needs Electron. */
const GUIDE_MENU_ITEM_ID = 'help.guide'

/**
 * The scripts the page has compiled so far, by file name, as its debugger lists them: enabling the
 * debugger reports every script already parsed. (The page's resource timing lists no file:// script.)
 */
async function parsedScripts(window: Page): Promise<string[]> {
  const cdp = await window.context().newCDPSession(window)
  const urls: string[] = []
  cdp.on('Debugger.scriptParsed', (event) => urls.push(event.url))
  await cdp.send('Debugger.enable')
  await cdp.send('Debugger.disable')
  await cdp.detach()
  return urls.map((url) => url.split('/').at(-1) ?? '').filter((name) => name.endsWith('.js'))
}

/** The chunk of the Guide's window in the build e2e runs (out/renderer/assets/GuideWindow-<hash>.js). */
async function guideChunk(): Promise<string> {
  const assets = join(repoRoot, 'out', 'renderer', 'assets')
  const chunks = (await readdir(assets)).filter((name) => /^GuideWindow-.*\.js$/.test(name))
  expect(chunks, 'the build has one chunk of the Guide window').toHaveLength(1)
  return chunks[0]!
}

test('nothing opens the Guide at the start, and the start does not fetch its chunk', async () => {
  const chunk = await guideChunk()
  // The first chunk of the app does not carry the Guide's texts: they are in the Guide's chunk only.
  const assets = join(repoRoot, 'out', 'renderer', 'assets')
  const entry = (await readdir(assets)).filter((name) => /^index-.*\.js$/.test(name))
  expect(entry.length).toBeGreaterThan(0)
  for (const name of entry) expect(await readFile(join(assets, name), 'utf8'), name).not.toContain('No Topics yet.')
  expect(await readFile(join(assets, chunk), 'utf8')).toContain('No Topics yet.')

  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // Long enough for whatever the start does once the shell is on screen.
    await window.waitForTimeout(1500)
    await expect(window.getByRole('dialog', { name: 'worfy Guide' })).toHaveCount(0)
    const scripts = await parsedScripts(window)
    expect(scripts.some((name) => /^index-.*\.js$/.test(name)), 'the debugger lists the first chunk').toBe(true)
    expect(scripts).not.toContain(chunk)

    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    await expect(window.getByRole('dialog', { name: 'worfy Guide' })).toBeVisible()
    await expect.poll(() => parsedScripts(window)).toContain(chunk)
  } finally {
    await launched.close()
  }
})

test('Help ▸ worfy Guide and the palette open it, Esc closes it, and the language switch outlives a restart', async () => {
  // One data folder for both starts of the app: the choice of language is kept there.
  const dataDir = await mkdtemp(join(tmpdir(), 'worfy-e2e-guide-'))
  try {
    const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      const { app, window } = launched
      const guide = window.getByRole('dialog', { name: 'worfy Guide' })
      await expect(window.getByTestId('app-shell')).toBeVisible()

      // From the menu: English by default (the tests run the app in en-US), the first Topic — the
      // Map of worfy (ticket 05) — on screen.
      await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
      await expect(guide).toBeVisible()
      await expect(guide).toHaveAttribute('data-language', 'en')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'map-of-worfy')
      await expect(guide.getByRole('heading', { name: 'Map of worfy' })).toBeVisible()
      await expect(guide.getByRole('link', { name: /Full page/ })).toHaveAttribute('href', /^https:\/\/github\.com\/IDSAD-XL\/worfy\/blob\/[0-9a-f]{7,40}\/docs\/features\/concepts\.md$/)
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)

      // From the palette: the Guide's own row, and the row of a Topic.
      await window.keyboard.press('ControlOrMeta+k')
      await window.getByTestId('palette-input').fill('worfy guide')
      await expect(window.locator('[data-testid="palette-option"][data-command="guide"]')).toBeVisible()
      await window.keyboard.press('Enter')
      await expect(guide).toBeVisible()
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)
      await window.keyboard.press('ControlOrMeta+k')
      await window.getByTestId('palette-input').fill('how the guide works')
      await expect(window.locator('[data-testid="palette-option"][data-command="guide:skeleton"]')).toBeVisible()
      await window.keyboard.press('Enter')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'skeleton')

      // The switch: Russian at once, kept in the app settings of this Machine.
      await guide.getByTestId('guide-language-ru').click()
      await expect(guide).toHaveAttribute('data-language', 'ru')
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('lang', 'ru')
      await expect.poll(async () => (JSON.parse(await readFile(join(dataDir, 'app-settings.json'), 'utf8')) as { guideLanguage?: string }).guideLanguage).toBe('ru')
      await window.keyboard.press('Escape')
      await expect(guide).toHaveCount(0)
    } finally {
      await launched.close()
    }

    // A new start of the app over the same data folder opens the Guide in Russian.
    const relaunched = await launchApp({ env: { WORFY_DATA_DIR: dataDir } })
    try {
      await expect(relaunched.window.getByTestId('app-shell')).toBeVisible()
      await clickMenuItem(relaunched.app, GUIDE_MENU_ITEM_ID)
      await expect(relaunched.window.getByRole('dialog', { name: 'worfy Guide' })).toHaveAttribute('data-language', 'ru')
    } finally {
      await relaunched.close()
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('snapshots of the Guide in both themes and both languages', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 800 })
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await expect(guide).toBeVisible()
    // Under the hood unfolded, so the snapshot shows the whole Topic.
    await guide.locator('summary').click()
    const evidence = process.env.WORFY_EVIDENCE_DIR
    for (const language of ['en', 'ru'] as const) {
      await guide.getByTestId(`guide-language-${language}`).click()
      await expect(guide).toHaveAttribute('data-language', language)
      // Headings are capitals in English only: a Latin term with a Russian ending reads badly in capitals.
      await expect(guide.locator('.w-guide__list .w-guide__heading')).toHaveCSS('text-transform', language === 'ru' ? 'none' : 'uppercase')
      const shots = await snapshotThemes(window, `guide-${language}`)
      if (evidence === undefined || evidence === '') continue
      await mkdir(evidence, { recursive: true })
      await copyFile(shots.light, join(evidence, `03-guide-${language}-light.png`))
      await copyFile(shots.dark, join(evidence, `03-guide-${language}-dark.png`))
    }
  } finally {
    await launched.close()
  }
})

// worfy-guide ticket 04 (ADR-0090 point 9): the live diagram. Its dots run on requestAnimationFrame
// only while the open Guide shows it; the checks count the frames the page asks for over a number of
// frames of its own (framesAskedOver), never over a span of clock time. Under Reduce motion no frame
// runs, the dots stand at (i + 0.5) / n of their Edge and the highlight changes at once.

/** What countFrames adds to the page's global object. */
interface FrameCounter {
  __framesAsked: number
  __rawFrame: (callback: (time: number) => void) => number
  requestAnimationFrame: (callback: (time: number) => void) => number
}

/** From now on the page counts every requestAnimationFrame it is asked for. */
async function countFrames(window: Page): Promise<void> {
  await window.evaluate(() => {
    const page = globalThis as unknown as FrameCounter
    page.__framesAsked = 0
    page.__rawFrame = page.requestAnimationFrame.bind(page)
    page.requestAnimationFrame = (callback) => {
      page.__framesAsked += 1
      return page.__rawFrame(callback)
    }
  })
}

/** How many frames the page asked for while `frames` of its frames went by. */
async function framesAskedOver(window: Page, frames: number): Promise<number> {
  return window.evaluate(
    (count) =>
      new Promise<number>((resolve) => {
        const page = globalThis as unknown as FrameCounter
        const start = page.__framesAsked
        let left = count
        const next = (): void => {
          left -= 1
          if (left === 0) resolve(page.__framesAsked - start)
          else page.__rawFrame(next)
        }
        page.__rawFrame(next)
      }),
    frames,
  )
}

/** Shows the test Topic, whose diagram the checks of ticket 04 know; the Guide opens at the Map of worfy. */
async function showTestTopic(guide: Locator): Promise<void> {
  await guide.locator('[data-testid="guide-topic-item"][data-topic="skeleton"]').click()
  await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'skeleton')
}

/** The `transform` of every dot of the diagram, in order. */
async function dotPlaces(window: Page): Promise<string[]> {
  return window.locator('[data-testid="guide-scene"] [data-dot-edge]').evaluateAll((dots) => dots.map((dot) => dot.getAttribute('transform') ?? ''))
}

test('the diagram moves its dots only while the open Guide shows it in view', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    // A low window, so Under the hood unfolded pushes the diagram out of the Guide's view.
    await window.setViewportSize({ width: 1280, height: 520 })
    await countFrames(window)
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await showTestTopic(guide)
    const scene = guide.getByTestId('guide-scene')
    await expect(scene).toHaveAttribute('data-motion', 'running')
    const first = await dotPlaces(window)
    expect(first).toHaveLength(6)
    await expect.poll(() => dotPlaces(window)).not.toEqual(first)
    expect(await framesAskedOver(window, 10)).toBeGreaterThan(0)

    // Folded, the data-flow diagram of Under the hood (Flow.tsx) is not in view and does not move.
    const flow = guide.getByTestId('guide-flow')
    await expect(flow).toHaveAttribute('data-motion', 'paused')
    // Scrolled out of view: the diagram's loop stops, and its dots stay where they are, while the
    // data-flow diagram, unfolded and now in view, moves: only a diagram in view runs.
    await guide.locator('summary').click()
    await guide.locator('.w-guide__content').evaluate((content) => content.scrollTo(0, content.scrollHeight))
    await expect(scene).toHaveAttribute('data-motion', 'paused')
    await expect(flow).toHaveAttribute('data-motion', 'running')
    const stopped = await dotPlaces(window)
    expect(await framesAskedOver(window, 10)).toBeGreaterThan(0)
    expect(await dotPlaces(window)).toEqual(stopped)
    await guide.locator('.w-guide__content').evaluate((content) => content.scrollTo(0, 0))
    await expect(scene).toHaveAttribute('data-motion', 'running')
    await expect.poll(() => dotPlaces(window)).not.toEqual(stopped)

    // Closed: the diagram is gone and nothing asks for a frame.
    await window.keyboard.press('Escape')
    await expect(guide).toHaveCount(0)
    await expect(window.getByTestId('guide-scene')).toHaveCount(0)
    await expect(window.getByTestId('guide-flow')).toHaveCount(0)
    expect(await framesAskedOver(window, 10)).toBe(0)
  } finally {
    await launched.close()
  }
})

test('under Reduce motion the dots stand still at (i + 0.5) / n and the highlight changes at once', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await countFrames(window)
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await showTestTopic(guide)
    const scene = guide.getByTestId('guide-scene')
    await expect(scene).toHaveAttribute('data-motion', 'still')
    expect(await framesAskedOver(window, 10)).toBe(0)
    // Each dot stands on its own path, at (i + 0.5) / n of its length.
    const misplaced = await scene.evaluate((svg) => {
      const wrong: string[] = []
      type Path = { dataset: Record<string, string>; getTotalLength(): number; getPointAtLength(distance: number): { x: number; y: number } }
      for (const path of svg.querySelectorAll('path[data-edge]') as unknown as Path[]) {
        const dots = [...svg.querySelectorAll(`[data-dot-edge="${path.dataset.edge}"]`)]
        dots.forEach((dot, index) => {
          const point = path.getPointAtLength(((index + 0.5) / dots.length) * path.getTotalLength())
          const [x, y] = (/translate\(([-\d.]+) ([-\d.]+)\)/.exec(dot.getAttribute('transform') ?? '') ?? []).slice(1).map(Number)
          if (x === undefined || y === undefined || Math.abs(x - point.x) > 0.1 || Math.abs(y - point.y) > 0.1) wrong.push(`${path.dataset.edge} #${index}`)
        })
      }
      return wrong
    })
    expect(misplaced).toEqual([])

    // The meaning stays: the pointer on a block lights its Edges and their labels, with no transition.
    const menu = scene.locator('[data-block="menu"]')
    await expect(menu).toHaveCSS('transition-duration', '0s')
    await menu.hover()
    await expect(scene.locator('[data-edge-label="menu->guide"]')).toHaveCSS('opacity', '1')
    await expect(scene.locator('[data-block="topics"]')).toHaveCSS('opacity', '0.2')
    // The step player still works.
    await window.mouse.move(0, 0)
    await guide.getByRole('button', { name: 'Step 3' }).click()
    await expect(guide.getByTestId('guide-scene-caption')).not.toHaveText('')
    await expect(scene.locator('[data-block="topics"]')).toHaveClass(/is-hot/)
  } finally {
    await launched.close()
  }
})

test('snapshots of the diagram: the flow, a lit block, a step, and Reduce motion', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 800 })
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await showTestTopic(guide)
    const scene = guide.getByTestId('guide-scene')
    await expect(scene).toHaveAttribute('data-motion', 'running')
    const evidence = process.env.WORFY_EVIDENCE_DIR
    const keep = async (name: string): Promise<void> => {
      const shots = await snapshotThemes(window, `guide-scene-${name}`)
      if (evidence === undefined || evidence === '') return
      await mkdir(evidence, { recursive: true })
      await copyFile(shots.light, join(evidence, `04-scene-${name}-light.png`))
      await copyFile(shots.dark, join(evidence, `04-scene-${name}-dark.png`))
    }
    // The pointer on the Guide block: its three Edges lit, with their labels.
    await scene.locator('[data-block="guide"]').hover()
    await expect(scene.locator('[data-edge-label="guide->topics"]')).toHaveClass(/is-hot/)
    await keep('lit')
    // Step 2 of the player, the pointer off the diagram.
    await window.mouse.move(0, 0)
    await guide.getByRole('button', { name: 'Step 2' }).click()
    await expect(scene.locator('[data-edge="palette->guide"]')).toHaveClass(/is-hot/)
    await keep('step')
    // Reduce motion, in Russian: still dots and the same step.
    await guide.getByTestId('guide-language-ru').click()
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await expect(scene).toHaveAttribute('data-motion', 'still')
    await keep('reduced-motion-ru')
  } finally {
    await launched.close()
  }
})

// worfy-guide ticket 05: the Map of worfy, the first Topic. Each block leads to its Topic while the
// Guide has it, else to that Topic's page of docs/features/ on GitHub — opened in the system's
// browser, which here only records the address. Snapshots in both themes and both languages, a lit
// block, a step, Reduce motion and Under the hood unfolded; with WORFY_EVIDENCE_DIR set they are
// copied there as 05-map-<what>-<theme>.png.

test('the Map of worfy is the first Topic, and each of its blocks opens its Topic or its Full page', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 800 })
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    const opened = () => app.evaluate(() => [...(globalThis as unknown as { opened: string[] }).opened])
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    await expect(guide.getByTestId('guide-topic-item').first()).toHaveAttribute('data-topic', 'map-of-worfy')
    await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'map-of-worfy')
    const scene = guide.getByTestId('guide-scene')
    const blocks = scene.locator('[data-block]')
    await expect(blocks).toHaveCount(17)

    let topics = 0
    for (const id of await blocks.evaluateAll((all) => all.map((block) => block.getAttribute('data-block') ?? ''))) {
      const block = scene.locator(`[data-block="${id}"]`)
      const kind = await block.getAttribute('data-target')
      const to = (await block.getAttribute('data-to')) ?? ''
      expect(['topic', 'page'], id).toContain(kind)
      const before = (await opened()).length
      // On its shape: a tab's note stands apart from it, and the middle of the two is empty.
      await block.locator('rect').first().click()
      if (kind === 'page') {
        await expect.poll(async () => (await opened()).slice(before), id).toEqual([expect.stringMatching(new RegExp(`^https://github\\.com/IDSAD-XL/worfy/blob/[0-9a-f]{7,40}/${to.replaceAll('.', '\\.')}$`))])
        await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'map-of-worfy')
      } else {
        topics += 1
        await expect(guide.getByTestId('guide-topic'), id).toHaveAttribute('data-topic', to)
        expect(await opened()).toHaveLength(before)
        await guide.locator('[data-testid="guide-topic-item"][data-topic="map-of-worfy"]').click()
      }
    }
    // Written Topics (worfy-guide 06-08 and on) are opened from the Map. The page branch above runs
    // only while some block's Topic is not written; once worfy-guide 11-19 have written them all, the
    // Full-page path is checked by the unit test alone (test/unit/guide-map.test.tsx, which hides
    // Topics from the registry).
    expect(topics).toBeGreaterThan(0)
    // The keyboard: Enter on a focused block opens it as a click does, whichever it leads to.
    const before = (await opened()).length
    const gate = scene.locator('[data-block="gate"]')
    const gateTarget = await gate.getAttribute('data-target')
    await gate.focus()
    await window.keyboard.press('Enter')
    if (gateTarget === 'page') {
      await expect.poll(async () => (await opened()).slice(before)).toEqual([expect.stringMatching(/\/docs\/features\/gate-and-github\.md$/)])
    } else {
      await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'gate-and-github')
      expect(await opened()).toHaveLength(before)
    }
  } finally {
    await launched.close()
  }
})

test('snapshots of the Map of worfy: both themes and languages, a lit block, a step, Reduce motion, Under the hood', async () => {
  const launched = await launchApp()
  try {
    const { app, window } = launched
    await expect(window.getByTestId('app-shell')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 800 })
    await clickMenuItem(app, GUIDE_MENU_ITEM_ID)
    const guide = window.getByRole('dialog', { name: 'worfy Guide' })
    const scene = guide.getByTestId('guide-scene')
    await expect(guide.getByTestId('guide-topic')).toHaveAttribute('data-topic', 'map-of-worfy')
    await expect(scene).toHaveAttribute('data-motion', 'running')
    const evidence = process.env.WORFY_EVIDENCE_DIR
    const keep = async (name: string): Promise<void> => {
      const shots = await snapshotThemes(window, `guide-map-${name}`)
      if (evidence === undefined || evidence === '') return
      await mkdir(evidence, { recursive: true })
      await copyFile(shots.light, join(evidence, `05-map-${name}-light.png`))
      await copyFile(shots.dark, join(evidence, `05-map-${name}-dark.png`))
    }
    for (const language of ['en', 'ru'] as const) {
      await guide.getByTestId(`guide-language-${language}`).click()
      await expect(guide).toHaveAttribute('data-language', language)
      await keep(language)
    }
    // The pointer on the Session: its Harness, Subagent, Ticket, Card and Browser lit, with the labels.
    await guide.getByTestId('guide-language-en').click()
    await scene.locator('[data-block="session"]').hover()
    await expect(scene.locator('[data-edge-label="session->ticket"]')).toHaveCSS('opacity', '1')
    await expect(scene.locator('[data-block="limits"]')).toHaveCSS('opacity', '0.2')
    await keep('lit-en')
    // Step 1 of the player: the Epic, its Ticket and Wave, Autopilot and Limits.
    await window.mouse.move(0, 0)
    await guide.getByRole('button', { name: 'Step 1' }).click()
    await expect(scene.locator('[data-edge="autopilot->wave"]')).toHaveClass(/is-hot/)
    // The player and its caption in view, under the diagram.
    await guide.getByTestId('guide-scene-caption').evaluate((caption) => caption.scrollIntoView({ block: 'end' }))
    await keep('step-en')
    // Reduce motion, in Russian: still dots, the same step.
    await guide.getByTestId('guide-language-ru').click()
    await window.emulateMedia({ reducedMotion: 'reduce' })
    await expect(scene).toHaveAttribute('data-motion', 'still')
    await keep('reduced-motion-ru')
    // Under the hood unfolded and scrolled to, in both languages.
    await window.emulateMedia({ reducedMotion: null })
    // Step 1 again: the whole diagram (the button's name is Russian now).
    await guide.locator('.w-guide-steps__step').nth(0).click()
    await guide.locator('summary').click()
    for (const language of ['en', 'ru'] as const) {
      await guide.getByTestId(`guide-language-${language}`).click()
      await expect(guide).toHaveAttribute('data-language', language)
      // Its heading at the top of the Topic's scrolled area, under the window's header, not behind it.
      await guide.locator('summary').evaluate((summary) => summary.scrollIntoView({ block: 'start' }))
      await keep(`under-the-hood-${language}`)
    }
  } finally {
    await launched.close()
  }
})
