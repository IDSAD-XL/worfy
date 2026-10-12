// The watch of a Tickets root on Windows, over real folders and real links (worfy-windows ticket
// 20). A symlink to `\\worfy-no-such-host\share\…` stands in for a link a checked-out repository
// carries: no host of that name answers, so a call through the link costs more than a second and
// fails — and every call Node makes is counted here, so one that names a path through the link
// is seen whether it is slow or not. Only Windows has the rule, and making a symlink there needs
// Developer Mode: without it the cases with the share are skipped, with the reason.
//
// `epic-status` is a stand-in that lists the folders; the bash script does not run on Windows.
import fs, { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { watch } from 'chokidar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDelta } from '../../src/shared/workflow/types'
import { removeTree } from '../../src/main/storage/remove'
import type { ProjectLayout } from '../../src/main/workflow/folder'
import type { EpicStatusRunner } from '../../src/main/workflow/reader'
import { ticketsIgnored, WorkflowWatcher } from '../../src/main/workflow/watch'
import { canLink, countFsCalls, SHARE, through, until } from './counted-fs'

const WINDOWS = process.platform === 'win32'
const LINKS = canLink()

let dir: string
let repo: string
let scratch: string
const closers: (() => Promise<void> | void)[] = []

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-watch-links-')))
  repo = join(dir, 'repo')
  scratch = join(repo, '.scratch')
  mkdirSync(repo)
})

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
  // removeTree takes a link away as a link: nothing here is followed.
  removeTree(dir)
})

const ticket = (num: number, title: string): string => `# ${String(num).padStart(2, '0')} — ${title}\n\nType: task\nStatus: open\nBlocked by: —\n`

function writeTicket(root: string, epic: string, num: number, title: string): string {
  mkdirSync(join(root, epic, 'issues'), { recursive: true })
  const file = join(root, epic, 'issues', `${String(num).padStart(2, '0')}-${title}.md`)
  writeFileSync(file, ticket(num, title))
  return file
}

/**
 * `epic-status --json` over the folders of the Tickets root. A link is listed only when `follow`
 * names it: the stand-in itself never goes through a link the test did not allow.
 */
const listing =
  (follow: readonly string[] = []): EpicStatusRunner =>
  async () => {
    const epics: { epic: string; hasSpec: boolean; hasMap: boolean }[] = []
    const tickets: Record<string, unknown>[] = []
    const entries = (() => {
      try {
        // lstat first: a Tickets root that is a link is not listed.
        return fs.lstatSync(scratch).isDirectory() ? readdirSync(scratch, { withFileTypes: true }) : []
      } catch {
        return []
      }
    })()
    for (const entry of entries) {
      if (!entry.isDirectory() && !follow.includes(entry.name)) continue
      const names = (() => {
        try {
          // lstat first: an `issues` that is a link is not listed either.
          return fs.lstatSync(join(scratch, entry.name, 'issues')).isDirectory() ? readdirSync(join(scratch, entry.name, 'issues')) : []
        } catch {
          return []
        }
      })()
      epics.push({ epic: entry.name, hasSpec: false, hasMap: false })
      for (const name of names) {
        const match = /^(\d+)-(.+)\.md$/.exec(name)
        if (!match) continue
        tickets.push({ epic: entry.name, num: Number(match[1]), slug: match[2], title: match[2], statusRaw: 'open', state: 'open', blockedRaw: null, blockedNums: [], blockedParsed: true })
      }
    }
    return JSON.stringify({ ref: 'checkout', epics, tickets })
  }

const layoutOf = (ticketsRoot: string) => async (root: string): Promise<ProjectLayout> => ({ root, mode: 'silent', workflowFolder: root, ticketsRoot, repos: [], workspace: null, reason: null })

interface Started {
  watcher: WorkflowWatcher
  deltas: WorkflowDelta[]
  startMs: number
}
async function start(options: { follow?: readonly string[]; ticketsWatch?: 'links-read-first' | 'chokidar' } = {}): Promise<Started> {
  const deltas: WorkflowDelta[] = []
  const at = performance.now()
  const watcher = await WorkflowWatcher.start({
    root: repo,
    claudeHome: join(dir, 'claude-home'),
    debounceMs: 50,
    onChange: (delta) => deltas.push(delta),
    run: listing(options.follow),
    // Silent mode: the status lives in the folders alone, and git is not asked.
    layout: layoutOf(scratch),
    ...(options.ticketsWatch ? { ticketsWatch: options.ticketsWatch } : {}),
  })
  closers.push(() => watcher.close())
  return { watcher, deltas, startMs: performance.now() - at }
}

const numbers = (deltas: WorkflowDelta[]): string[] => deltas.flatMap((delta) => delta.tickets.map((each) => `${each.epic}/${each.num}`))

describe.runIf(WINDOWS)('the watch of a Tickets root on Windows', () => {
  it('sees a new Ticket, an edit of it, and a new Epic', async () => {
    writeTicket(scratch, 'demo', 1, 'first')
    const { watcher, deltas } = await start()
    expect(watcher.current.tickets.map((each) => each.num)).toEqual([1])

    writeTicket(scratch, 'demo', 2, 'second')
    await until('the second Ticket', () => numbers(deltas).includes('demo/2'))
    writeTicket(scratch, 'next', 1, 'other')
    await until('the Ticket of a new Epic', () => numbers(deltas).includes('next/1'))
  })

  it('follows a Tickets root made after the start, and one that is removed and made again', async () => {
    const { watcher, deltas } = await start()
    expect(watcher.current.tickets).toEqual([])

    writeTicket(scratch, 'demo', 1, 'first')
    await until('the first Ticket of a root made after the start', () => numbers(deltas).includes('demo/1'))
    await watcher.idle()

    removeTree(scratch)
    await until('the Ticket to go with its root', () => deltas.some((delta) => delta.removedTickets.length > 0))
    await watcher.idle()
    deltas.length = 0
    writeTicket(scratch, 'again', 3, 'third')
    await until('a Ticket of the root made again', () => numbers(deltas).includes('again/3'))
  })

  it('a junction to a folder of this machine in place of an Epic folder: a Ticket written behind it reaches the model', async () => {
    const behind = join(dir, 'elsewhere', 'epic')
    writeTicket(join(dir, 'elsewhere'), 'epic', 1, 'first')
    mkdirSync(scratch)
    symlinkSync(behind, join(scratch, 'linked'), 'junction')
    const { watcher, deltas } = await start({ follow: ['linked'] })
    expect(watcher.current.tickets.map((each) => `${each.epic}/${each.num}`)).toEqual(['linked/1'])

    // Written by the real path: the watch of the root says nothing of it.
    writeFileSync(join(behind, 'issues', '02-second.md'), ticket(2, 'second'))
    await until('the Ticket behind the junction', () => numbers(deltas).includes('linked/2'))
  })

  it.runIf(LINKS)('a symlink to an unreachable share in place of an Epic folder: the start does not wait for the network, no call of Node names a path through the link, and a new Ticket next to it reaches the model', async () => {
    writeTicket(scratch, 'demo', 1, 'first')
    const link = join(scratch, 'away')
    symlinkSync(`${SHARE}\\epic`, link, 'dir')
    const counted = countFsCalls()
    try {
      const { watcher, deltas, startMs } = await start()
      expect(watcher.current.tickets.map((each) => each.num)).toEqual([1])
      // realpath of such a link takes more than a second to fail (measured on the PC: 1264 ms).
      expect(startMs).toBeLessThan(1000)

      writeTicket(scratch, 'demo', 2, 'second')
      await until('the second Ticket', () => numbers(deltas).includes('demo/2'))
      await watcher.idle()
      expect(through(counted.calls, link)).toEqual([])
      // The link was looked at, as a link.
      expect(counted.calls.map((call) => call.toLowerCase())).toContain(`readlink ${link.toLowerCase()}`)
    } finally {
      counted.restore()
    }
  }, 30_000)

  it.runIf(LINKS)('the same link in place of the issues folder, of a Ticket file, and of the Tickets root itself', async () => {
    writeTicket(scratch, 'demo', 1, 'first')
    mkdirSync(join(scratch, 'other'))
    const links = [join(scratch, 'other', 'issues'), join(scratch, 'demo', 'issues', '09-away.md')]
    symlinkSync(`${SHARE}\\issues`, links[0]!, 'dir')
    symlinkSync(`${SHARE}\\ticket.md`, links[1]!, 'file')
    const counted = countFsCalls()
    try {
      const { watcher, deltas, startMs } = await start()
      expect(startMs).toBeLessThan(1000)
      writeTicket(scratch, 'demo', 2, 'second')
      await until('the second Ticket', () => numbers(deltas).includes('demo/2'))
      await watcher.idle()
      for (const link of links) expect(through(counted.calls, link), link).toEqual([])
      await watcher.close()

      // The Tickets root itself: the Project opens, nothing is watched, nothing is asked through it.
      removeTree(scratch)
      const first = counted.calls.length
      symlinkSync(`${SHARE}\\scratch`, scratch, 'dir')
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const again = await start()
      // The refusal is said once, in the log: the canvas of such a Project stays as it was read.
      expect(logged.mock.calls.map((call) => String(call[0]))).toEqual([`[workflow] the Tickets root ${scratch} leads off this machine, or cannot be checked: it is not watched`])
      logged.mockRestore()
      expect(again.startMs).toBeLessThan(1000)
      expect(again.watcher.current.tickets).toEqual([])
      expect(through(counted.calls.slice(first), scratch)).toEqual([])
    } finally {
      counted.restore()
    }
  }, 30_000)

  it.skipIf(LINKS)('the cases with a symlink to a share are skipped: this user may not make a symlink (Developer Mode is off)', () => {
    expect(LINKS).toBe(false)
  })
})

// What the new watch is for. Kept as a test so that a chokidar that stops doing this is noticed.
describe.runIf(WINDOWS && LINKS)('chokidar on Windows, for comparison', () => {
  it('calls realpath on a link to a share in a folder it watches, with the filter of the Tickets root in place, and never says it is ready', async () => {
    writeTicket(scratch, 'demo', 1, 'first')
    const link = join(scratch, 'away')
    symlinkSync(`${SHARE}\\epic`, link, 'dir')
    const counted = countFsCalls()
    const watcher = watch(scratch, { ignoreInitial: true, ignored: ticketsIgnored(scratch) })
    closers.push(() => watcher.close())
    try {
      let ready = false
      const errors: unknown[] = []
      watcher.once('ready', () => {
        ready = true
      })
      watcher.on('error', (error) => errors.push(error))
      await until('the error of chokidar', () => errors.length > 0, 10_000)
      expect(through(counted.calls, link).map((call) => call.split(' ')[0])).toContain('realpath')
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(ready).toBe(false)
    } finally {
      counted.restore()
    }
  }, 30_000)
})
