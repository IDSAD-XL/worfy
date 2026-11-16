// A first read of the documents that fails on git (follow-up of worfy-polish ticket 118, ADR-0107). The documents of a
// Full-mode Project are read from its main branch; when git cannot read that branch at the start, the watcher still
// starts — with no documents — and reads again: after a growing wait, and at once when the main branch moves. Before,
// DocsWatcher.start threw and the active Project's documents (src/main/ipc/docs.ts, keepActive) were not watched until
// another Project became active.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocsState } from '../../src/shared/ipc/docs'
import { DocsHub, DocsWatcher, READ_RETRY_MAX_MS, SETTLE_READS_MS, versionOf, type DocsTreeSource, type WatchRoot } from '../../src/main/docs/watch'
import type { RepoTree } from '../../src/main/workflow/main-ref'
import { removeTestTree } from '../remove'
import { ms } from '../time-scale'

const HANDOFF = '# Handoff\n\nfrom main\n'
const ADR = '# 1. First\n\nStatus: accepted.\n'

/** The commit of a main branch with HANDOFF.md and one ADR. */
const tree: RepoTree = {
  sha: 'a'.repeat(40),
  committedAt: 0,
  names: (dir) => Promise.resolve(dir === 'docs/adr' ? ['0001-first.md'] : []),
  texts: (files) =>
    Promise.resolve(new Map(files.flatMap((file): Array<[string, string]> => (file === 'HANDOFF.md' ? [[file, HANDOFF]] : file === 'docs/adr/0001-first.md' ? [[file, ADR]] : [])))),
  addedAt: () => Promise.resolve(new Map()),
}

/** No watch of the disk: the documents come from the main branch only. */
const noWatch: WatchRoot = () => ({ close: () => undefined })

/** A main branch that git cannot read while `failing` is true; `move` calls the listeners of its moves. */
function flakySource(): DocsTreeSource & { failing: boolean; asked: number; move: () => void } {
  const listeners = new Set<() => void>()
  const source = {
    failing: true,
    asked: 0,
    tree: () => {
      source.asked += 1
      return source.failing ? Promise.reject(new Error('git ls-tree failed')) : Promise.resolve(tree)
    },
    onMoved: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    move: () => {
      for (const listener of listeners) listener()
    },
  }
  return source
}

const cleanups: Array<() => Promise<unknown> | unknown> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function quietErrors() {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  cleanups.push(() => errors.mockRestore())
  return errors
}

describe('a first read of the documents that fails on git', () => {
  it('starts the watcher with no documents and reads again after a while, until git reads the main branch', async () => {
    const errors = quietErrors()
    const source = flakySource()
    const changes: unknown[] = []
    const watcher = await DocsWatcher.start({ root: '/project', debounceMs: 5, retryMs: 20, watch: noWatch, source, onChange: (docs) => changes.push(docs) })
    cleanups.push(() => watcher.close())

    // No documents, and why: "not read", not "none".
    expect(watcher.current).toEqual({ handoff: null, adrs: [], readError: 'git ls-tree failed' })
    expect(watcher.read).toBe(false)
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[docs]'), expect.objectContaining({ message: 'git ls-tree failed' }))
    // The reads that follow the start of a watch (SETTLE_READS_MS, up to 1 s) are over: the start and they asked 4 times.
    await new Promise((done) => setTimeout(done, 1_200))
    // Tried again by itself, more than those, while git still fails; the failure is said once.
    await vi.waitFor(() => expect(source.asked).toBeGreaterThan(SETTLE_READS_MS.length + 2), { timeout: ms(5_000), interval: 10 })
    expect(errors.mock.calls.filter(([line]) => String(line).startsWith('[docs]'))).toHaveLength(1)

    source.failing = false
    await vi.waitFor(() => expect(watcher.read).toBe(true), { timeout: ms(5_000), interval: 10 })
    expect(watcher.current.handoff?.version).toBe(versionOf(HANDOFF))
    expect(watcher.current.adrs.map((adr) => adr.number)).toEqual(['0001'])
    expect(watcher.current.readError).toBeUndefined()
    expect(changes).toHaveLength(1)

    // Read once: no more reads come by themselves.
    const asked = source.asked
    await new Promise((done) => setTimeout(done, 200))
    expect(source.asked).toBe(asked)
  })

  it('reads at once when the main branch moves, without waiting for the next try', async () => {
    quietErrors()
    const source = flakySource()
    // A wait between two tries far longer than the test: only the move can read.
    const watcher = await DocsWatcher.start({ root: '/project', debounceMs: 5, retryMs: 600_000, watch: noWatch, source, onChange: () => undefined })
    cleanups.push(() => watcher.close())
    // The reads that follow the start of a watch (SETTLE_READS_MS, up to 1 s) are over, and failed.
    await new Promise((done) => setTimeout(done, 1_200))
    expect(watcher.read).toBe(false)

    source.failing = false
    source.move()
    await vi.waitFor(() => expect(watcher.current.handoff?.version).toBe(versionOf(HANDOFF)), { timeout: ms(5_000), interval: 10 })
  })

  it('the hub opens the Project with no documents and tells its subscribers, and the HANDOFF Node, only what was read', async () => {
    quietErrors()
    const source = flakySource()
    const states: DocsState[] = []
    const sent: DocsState[] = []
    const hub = new DocsHub({ debounceMs: 5, onState: (state) => states.push(state) })
    cleanups.push(() => hub.closeAll())
    // The hub watches the folder on the disk: an empty one.
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-retry-')))
    cleanups.push(() => removeTestTree(root))

    const opened = await hub.open('p1', root, { id: 'main', send: (state) => sent.push(state) }, undefined, undefined, source)

    expect(opened).toEqual({ projectId: 'p1', handoff: null, adrs: [], readError: 'git ls-tree failed' })
    expect(hub.projects).toEqual(['p1'])
    await new Promise((done) => setTimeout(done, 150))
    // No state that is no read: the HANDOFF Node (src/main/ipc/docs.ts, syncHandoffNode) is not hidden for a git error.
    expect(states).toEqual([])

    source.failing = false
    source.move()
    await vi.waitFor(() => expect(sent.at(-1)?.handoff?.version).toBe(versionOf(HANDOFF)), { timeout: ms(5_000), interval: 10 })
    expect(sent.at(-1)?.readError).toBeUndefined()
    expect(states.at(-1)?.handoff?.version).toBe(versionOf(HANDOFF))
  })

  it('a watch made anew (a hold let go) whose first read fails keeps what the windows show, and sends the next read that works', async () => {
    quietErrors()
    const source = flakySource()
    source.failing = false
    const sent: DocsState[] = []
    const hub = new DocsHub({ debounceMs: 5 })
    cleanups.push(() => hub.closeAll())
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-docs-retry-')))
    cleanups.push(() => removeTestTree(root))
    const opened = await hub.open('p1', root, { id: 'window', send: (state) => sent.push(state) }, undefined, undefined, source)
    expect(opened.handoff?.version).toBe(versionOf(HANDOFF))

    // Something renames the folder (project-connect --remove, a move between Full and Silent mode); main is unreadable then.
    const release = await hub.hold('p1')
    source.failing = true
    await release()
    await new Promise((done) => setTimeout(done, 150))
    // No empty state over the documents the window shows.
    expect(sent.filter((state) => state.handoff === null)).toEqual([])

    source.failing = false
    source.move()
    await vi.waitFor(() => expect(sent.at(-1)?.handoff?.version).toBe(versionOf(HANDOFF)), { timeout: ms(5_000), interval: 10 })
    expect(sent.filter((state) => state.handoff === null)).toEqual([])
  })

  it('waits 2 s before the first try, twice as long before each next one, at most a minute, and stops at close', async () => {
    quietErrors()
    vi.useFakeTimers()
    cleanups.push(() => vi.useRealTimers())
    const source = flakySource()
    const at: number[] = []
    const tree = source.tree
    source.tree = () => {
      at.push(Date.now())
      return tree()
    }
    const start = Date.now()
    const watcher = await DocsWatcher.start({ root: '/project', debounceMs: 5, watch: noWatch, source, onChange: () => undefined })
    cleanups.push(() => watcher.close())

    await vi.advanceTimersByTimeAsync(1_999)
    // The start's own read and the reads after the start of a watch; no try yet.
    expect(at.map((time) => time - start)).toEqual([0, ...SETTLE_READS_MS])
    // Up to 4 min from the start: the tries at 2, 6, 14, 30, 62, 122 and 182 s.
    await vi.advanceTimersByTimeAsync(240_000 - 1_999)
    const tries = [0, ...at.slice(1 + SETTLE_READS_MS.length).map((time) => time - start)]
    const waits = tries.slice(1).map((time, index) => time - tries[index]!)
    expect(waits).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, READ_RETRY_MAX_MS, READ_RETRY_MAX_MS])

    await watcher.close()
    const asked = source.asked
    await vi.advanceTimersByTimeAsync(READ_RETRY_MAX_MS * 3)
    expect(source.asked).toBe(asked)
  })
})
