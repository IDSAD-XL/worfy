// The Changes screen (worfy-changes-view tickets 03 and 08): the view src/renderer/changes/ChangesView.tsx with its head
// (ScopeBar.tsx), its tree (FileTree.tsx) and its diff (DiffPane.tsx), over a bridge that answers the `changes.*`
// channels of ticket 02 as main would. What is checked is what the user sees: the scope menu built from the answer of
// `changes.scopes`, Inline and Side by side, Wrap, Hide whitespace, a large file folded and a binary file's sizes, the
// group Workflow files, the filter, the folders of a Ticket of more than 300 files, and the window of the diff.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangesScreen, ChangesView } from '../../src/renderer/changes/ChangesView'
import { openChanges, setChangesScope, useChangesView, type ChangesSubject } from '../../src/renderer/changes/open'
import { setView, useNavigation } from '../../src/renderer/session/navigation'
import { DiffPane, type ChangesThread, type DiffPaneProps } from '../../src/renderer/changes/DiffPane'
import { FileTree } from '../../src/renderer/changes/FileTree'
import { fileKey, sideBySideRows, windowOf } from '../../src/renderer/changes/diff-window'
import type { ChangedFile, ChangesScope, DiffLine, FileDiff } from '../../src/shared/changes/types'
import type { WorfyBridge } from '../../src/shared/ipc/channels'
import type { Ticket, WorkflowModel } from '../../src/shared/workflow/types'

const ROOT = '/Users/test/projects/demo'
const PROJECT = 'demo-0000000d'

const TICKET: Ticket = {
  epic: 'demo',
  num: 3,
  slug: 'cart',
  title: '03 — Cart',
  statusRaw: 'claimed',
  state: 'work',
  blockedRaw: null,
  blockedNums: [],
  blockedParsed: true,
  files: [],
  filesListed: true,
  fromBranch: 'demo/03',
}

function changed(path: string, over: Partial<ChangedFile> = {}): ChangedFile {
  return { path, oldPath: null, status: 'M', additions: 2, deletions: 1, binary: false, oldMode: '100644', newMode: '100644', oldBlob: 'a', newBlob: 'b', untracked: false, workflow: false, fold: null, ...over }
}

const line = (kind: DiffLine['kind'], text: string, oldLine: number | null, newLine: number | null): DiffLine => ({ kind, text, oldLine, newLine, crlf: false, noNewline: false })

const CART_DIFF: FileDiff = {
  kind: 'hunks',
  path: 'src/orders/cart.ts',
  oldPath: null,
  oldMode: '100644',
  newMode: '100644',
  whole: false,
  hunks: [
    {
      header: '@@ -1,3 +1,4 @@',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      section: '',
      lines: [line('context', "import { sum } from './money'", 1, 1), line('del', '  taxRate: number', 2, null), line('add', '  discount?: Discount', null, 2), line('add', 'const MAX = 0.5', null, 3), line('context', '}', 3, 4)],
    },
  ],
}

let files: ChangedFile[]
let scopesOf: ('all' | 'uncommitted' | 'commit' | 'compare')[]
let calls: { channel: string; input: Record<string, unknown> }[]
/** Holds an answer of the bridge until it is released (holdOnce); undefined — answered at once. */
let gate: ((channel: string, input: Record<string, unknown>) => Promise<void> | undefined) | null

/** Holds the next call of `channel` that `test` picks; the function returned releases its answer and lets it land. */
function holdOnce(channel: string, test: (input: Record<string, unknown>) => boolean = () => true): () => Promise<void> {
  let release!: () => void
  const wait = new Promise<void>((done) => {
    release = done
  })
  let taken = false
  const previous = gate
  gate = (each, input) => {
    if (!taken && each === channel && test(input)) {
      taken = true
      return wait
    }
    return previous?.(each, input)
  }
  return async () => {
    expect(taken).toBe(true)
    release()
    await settle()
  }
}

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 20))
  })

function answer(channel: string, input: Record<string, unknown>): unknown {
  const base = { ref: 'origin/main', from: 'worktree.base', mergeBase: '4f9c2e1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
  switch (channel) {
    case 'projects.list':
      return { projects: [{ id: PROJECT, name: 'demo', path: ROOT, branch: 'main' }], activeId: PROJECT, revision: 1 }
    case 'workflow.open':
      return { root: ROOT, epics: [{ epic: 'demo', hasSpec: true, hasMap: false, title: 'Demo' }], tickets: [TICKET], error: null, branchErrors: [] } satisfies WorkflowModel
    case 'changes.scopes':
      return { repos: [{ repo: 'demo', kind: 'worktree', branch: 'demo/03', headSha: 'c0ffee1', base, scopes: scopesOf, branches: ['main', 'release/1.4'], error: null }] }
    case 'changes.commits':
      return {
        base,
        commits: [
          { sha: '7e1d0a2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', short: '7e1d0a2', author: 'dev', date: '2026-11-19T10:00:00Z', subject: 'Cap stacked discounts' },
          { sha: 'c93b4f8ccccccccccccccccccccccccccccccccc', short: 'c93b4f8', author: 'dev', date: '2026-11-19T09:00:00Z', subject: 'Add discount types' },
        ],
      }
    case 'changes.list': {
      const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
      const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
      return { repos: [{ repo: 'demo', kind: 'worktree', branch: 'demo/03', scope: (input.scope as { kind: string }).kind, base, headSha: 'c0ffee1', workTree: true, files, additions, deletions, error: null }] }
    }
    case 'changes.file': {
      const path = input.path as string
      if (path === 'assets/logo.png') return { file: { kind: 'binary', path, oldSize: 12 * 1024, newSize: 14 * 1024 } }
      if (path === 'data/catalog.json' && input.expand !== true) return { file: { kind: 'folded', path, reason: 'large', lines: 2100 } }
      if (path === 'data/big.json') return { file: { kind: 'no-patch', path, url: 'https://github.com/acme/api/blob/b0b/data/big.json' } }
      if (path === 'src/orders/cart.ts') return { file: CART_DIFF }
      return { file: { ...CART_DIFF, path } }
    }
    default:
      return { closed: true }
  }
}

beforeEach(() => {
  calls = []
  gate = null
  useChangesView.setState({ projectId: null, subject: null, back: 'canvas', opened: 0, scopes: {} })
  setView('canvas')
  scopesOf = ['all', 'uncommitted', 'commit', 'compare']
  files = [
    changed('src/orders/cart.ts', { additions: 2, deletions: 1 }),
    changed('src/orders/discount.ts', { status: 'A', additions: 20, deletions: 0, oldMode: null, oldBlob: null }),
    changed('assets/logo.png', { binary: true, additions: null, deletions: null }),
    changed('data/catalog.json', { status: 'A', additions: 1243, deletions: 0, fold: 'large' }),
    changed('.scratch/demo/issues/03-cart.md', { workflow: true }),
    changed('.scratch/demo/stories/03-cart.md', { status: 'A', workflow: true }),
  ]
  const bridge = {
    invoke: (channel: string, input: Record<string, unknown>) => {
      calls.push({ channel, input })
      const result = { ok: true, value: answer(channel, input) }
      const wait = gate?.(channel, input)
      return wait === undefined ? Promise.resolve(result) : wait.then(() => result)
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
})

function view(subject: ChangesSubject = { epic: 'demo', num: 3 }) {
  return <ChangesView projectId={PROJECT} root={ROOT} subject={subject} back="canvas" active />
}

async function open(scope?: ChangesScope) {
  if (scope !== undefined) setChangesScope(PROJECT, { epic: 'demo', num: 3 }, scope)
  render(view())
  await screen.findAllByTestId('changes-line')
}

const fileCalls = (path: string) => calls.filter((call) => call.channel === 'changes.file' && call.input.path === path)
const diff = () => screen.getByTestId('changes-diff')

describe('the head', () => {
  it('names the base and the head, the merge-base, the files and the lines, the counts without a separator of thousands', async () => {
    await open()
    const meta = screen.getByTestId('changes-meta')
    expect(meta.textContent).toBe('origin/main ← demo/03 · base 4f9c2e1 · 4 files + 2 workflow · +1269 −3')
  })

  it('builds the menu of scopes from the answer of changes.scopes', async () => {
    await open()
    fireEvent.click(screen.getByTestId('changes-scope'))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.textContent)).toEqual(['All changesthe Ticket against the base', 'Uncommittedwork tree against HEAD', '7e1d0a2 Cap stacked discounts', 'c93b4f8 Add discount types'])
    expect(items[0]!.getAttribute('aria-checked')).toBe('true')
  })

  it('has no Uncommitted for a Ticket whose answer has none (a branch checked out nowhere)', async () => {
    scopesOf = ['all', 'commit', 'compare']
    await open()
    fireEvent.click(screen.getByTestId('changes-scope'))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.getAttribute('data-scope'))).toEqual(['all', 'commit', 'commit'])
  })

  it('a picked commit becomes the view’s scope of the Ticket, and the files are read for it', async () => {
    await open()
    fireEvent.click(screen.getByTestId('changes-scope'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /7e1d0a2/u }))
    const commit = { kind: 'commit', repo: 'demo', sha: '7e1d0a2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
    expect(useChangesView.getState().scopes).toEqual({ [`${PROJECT}:demo/3`]: commit })
    await vi.waitFor(() => expect(calls.filter((call) => call.channel === 'changes.list').at(-1)?.input.scope).toEqual(commit))
  })

  it('reads the scope the view keeps for the Ticket, and Compare against lists the branches of the answer', async () => {
    await open({ kind: 'compare', repo: 'demo', ref: 'release/1.4' })
    const lists = calls.filter((call) => call.channel === 'changes.list')
    expect(lists.at(-1)?.input.scope).toEqual({ kind: 'compare', repo: 'demo', ref: 'release/1.4' })
    expect(screen.getByTestId('changes-scope').textContent).toBe('Compare against release/1.4')
    fireEvent.click(screen.getByTestId('changes-compare'))
    const items = await screen.findAllByTestId('changes-compare-item')
    expect(items.map((item) => item.textContent)).toEqual(['main', 'release/1.4'])
  })
})

describe('the diff', () => {
  it('draws Inline by default: one row per line, with the numbers of both sides', async () => {
    await open()
    expect(diff().getAttribute('data-layout')).toBe('inline')
    const cart = fileCalls('src/orders/cart.ts')
    expect(cart).toHaveLength(1)
    const rows = within(diff()).getAllByTestId('changes-line').slice(0, 5)
    expect(rows.map((row) => [row.getAttribute('data-kind'), row.textContent])).toEqual([
      ['context', "11import { sum } from './money'"],
      ['del', '2−  taxRate: number'],
      ['add', '2+  discount?: Discount'],
      ['add', '3+const MAX = 0.5'],
      ['context', '34}'],
    ])
  })

  it('Side by side pairs a deleted line with the added one after it, and leaves the other side empty past it', async () => {
    await open()
    fireEvent.click(screen.getByTestId('changes-side-by-side'))
    expect(diff().getAttribute('data-layout')).toBe('side-by-side')
    const rows = within(diff()).getAllByTestId('changes-row').slice(0, 4)
    expect(rows.map((row) => row.getAttribute('data-kind'))).toEqual(['context', 'change', 'add', 'context'])
    expect(rows[1]!.textContent).toBe('2−  taxRate: number2+  discount?: Discount')
  })

  it('Wrap wraps the lines of the diff', async () => {
    await open()
    expect(diff().classList.contains('is-wrapped')).toBe(false)
    fireEvent.click(screen.getByTestId('changes-wrap'))
    expect(diff().getAttribute('data-wrap')).toBe('true')
    expect(diff().classList.contains('is-wrapped')).toBe(true)
  })

  it('Hide whitespace reads the list and the patches again without whitespace changes', async () => {
    await open()
    fireEvent.click(screen.getByTestId('changes-hide-whitespace'))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20))
    })
    expect(calls.filter((call) => call.channel === 'changes.list').at(-1)?.input.hideWhitespace).toBe(true)
    expect(fileCalls('src/orders/cart.ts').map((call) => call.input.hideWhitespace)).toEqual([false, true])
  })

  it('a large file comes folded without a read of its patch; Show reads it in full', async () => {
    await open()
    const folded = screen.getByTestId('changes-folded')
    expect(folded.textContent).toBe('Large diff · 1243 lines · Show')
    expect(fileCalls('data/catalog.json')).toEqual([])
    fireEvent.click(within(folded).getByTestId('changes-show'))
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20))
    })
    expect(fileCalls('data/catalog.json').map((call) => call.input.expand)).toEqual([true])
    expect(screen.queryByTestId('changes-folded')).toBeNull()
  })

  it('n and p go to the next and the previous hunk', async () => {
    await open()
    const body = screen.getByTestId('changes-body')
    // Before the patches are measured the heights are estimates: the header of cart.ts is 34 px, its hunk of five
    // lines 22 + 5 × 20 px and the gap under the file 12 px, the header of discount.ts 34 px.
    fireEvent.keyDown(body, { key: 'n' })
    expect(diff().scrollTop).toBe(34)
    fireEvent.keyDown(body, { key: 'n' })
    expect(diff().scrollTop).toBe(34 + 122 + 12 + 34)
    fireEvent.keyDown(body, { key: 'p' })
    expect(diff().scrollTop).toBe(34)
    fireEvent.keyDown(body, { key: 'p' })
    expect(diff().scrollTop).toBe(34)
  })

  it('a binary file shows the sizes of its two sides', async () => {
    await open()
    await vi.waitFor(() => expect(screen.getByTestId('changes-binary').textContent).toBe('Binary file · 12 KB → 14 KB'))
  })
})

describe('the tree', () => {
  it('puts the workflow files last, in the folded group Workflow files, out of the diff until it is opened', async () => {
    await open()
    const group = screen.getByTestId('changes-workflow-group')
    expect(group.textContent).toContain('Workflow files (2)')
    expect(group.getAttribute('aria-expanded')).toBe('false')
    const paths = () => screen.getAllByTestId('changes-tree-file').map((row) => row.getAttribute('data-path'))
    expect(paths()).toEqual(['src/orders/cart.ts', 'src/orders/discount.ts', 'assets/logo.png', 'data/catalog.json'])
    expect(within(diff()).getAllByTestId('changes-file').map((head) => head.getAttribute('data-path'))).toEqual(['src/orders/cart.ts', 'src/orders/discount.ts', 'assets/logo.png', 'data/catalog.json'])
    fireEvent.click(group)
    expect(paths().slice(-2)).toEqual(['.scratch/demo/issues/03-cart.md', '.scratch/demo/stories/03-cart.md'])
    expect(within(diff()).getAllByTestId('changes-file')).toHaveLength(6)
  })

  it('the filter narrows the tree and the diff to the matching files and says how many are left', async () => {
    await open()
    fireEvent.change(screen.getByTestId('changes-filter'), { target: { value: 'CART' } })
    expect(screen.getAllByTestId('changes-tree-file').map((row) => row.getAttribute('data-path'))).toEqual(['src/orders/cart.ts', '.scratch/demo/issues/03-cart.md', '.scratch/demo/stories/03-cart.md'])
    expect(screen.getByTestId('changes-filter-count').textContent).toBe('3 of 6 files')
    expect(within(diff()).getAllByTestId('changes-file')).toHaveLength(3)
    fireEvent.change(screen.getByTestId('changes-filter'), { target: { value: 'nothing-like-it' } })
    expect(screen.queryAllByTestId('changes-tree-file')).toEqual([])
    expect(screen.getByTestId('changes-filter-empty').textContent).toBe('No files match “nothing-like-it”')
  })

  it('over 300 files the folders come folded, and the diff draws only a window of them', async () => {
    files = Array.from({ length: 301 }, (_, index) => changed(`pkg/m${String(index % 30).padStart(2, '0')}/file-${String(index).padStart(3, '0')}.ts`))
    await open()
    const folders = screen.getAllByTestId('changes-tree-folder')
    expect(folders).toHaveLength(30)
    expect(folders.every((folder) => folder.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(screen.queryAllByTestId('changes-tree-file')).toEqual([])
    fireEvent.click(folders[0]!)
    expect(screen.getAllByTestId('changes-tree-file').length).toBeGreaterThan(0)
    const drawn = within(diff()).getAllByTestId('changes-file').length
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThan(301)
    expect(calls.filter((call) => call.channel === 'changes.file').length).toBeLessThan(301)
  })

  it('j and k walk the files, and a file picked in the tree is the selected one of the diff', async () => {
    await open()
    const body = screen.getByTestId('changes-body')
    fireEvent.keyDown(body, { key: 'j' })
    fireEvent.keyDown(body, { key: 'j' })
    const current = () => within(diff()).getAllByTestId('changes-file').find((head) => head.getAttribute('aria-current') === 'true')?.getAttribute('data-path')
    expect(current()).toBe('src/orders/discount.ts')
    fireEvent.keyDown(body, { key: 'k' })
    expect(current()).toBe('src/orders/cart.ts')
    fireEvent.click(screen.getAllByTestId('changes-tree-file')[2]!)
    expect(current()).toBe('assets/logo.png')
    // Typing in the filter is typing, not a key of the view.
    fireEvent.keyDown(screen.getByTestId('changes-filter'), { key: 'j' })
    expect(current()).toBe('assets/logo.png')
  })
})

describe('a late answer of a read gone by (round 1 of the review)', () => {
  const paths = () => screen.getAllByTestId('changes-tree-file').map((row) => row.getAttribute('data-path'))

  it('a list read for Hide whitespace that answers after the next read is dropped, not shown over it', async () => {
    await open()
    const release = holdOnce('changes.list', (input) => input.hideWhitespace === true)
    fireEvent.click(screen.getByTestId('changes-hide-whitespace'))
    await settle()
    fireEvent.click(screen.getByTestId('changes-hide-whitespace'))
    await settle()
    await release()
    expect(paths()).toEqual(['src/orders/cart.ts', 'src/orders/discount.ts', 'assets/logo.png', 'data/catalog.json'])
    expect(screen.getByTestId('changes-meta').textContent).toBe('origin/main ← demo/03 · base 4f9c2e1 · 4 files + 2 workflow · +1269 −3')
  })

  it('the scopes read for another Ticket that answers after this Ticket’s is dropped, not shown as «Reading…»', async () => {
    const release = holdOnce('changes.scopes')
    const { rerender } = render(view({ epic: 'demo', num: 3 }))
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'changes.scopes')).toBe(true))
    rerender(view({ epic: 'demo', num: 4 }))
    await screen.findAllByTestId('changes-line')
    await release()
    expect(screen.queryByText(/Reading the changes/u)).toBeNull()
    expect(paths()).toHaveLength(4)
  })

  it('the commits read for another Ticket that answer after this Ticket’s are dropped, and the menu keeps its commits', async () => {
    const release = holdOnce('changes.commits')
    const { rerender } = render(view({ epic: 'demo', num: 3 }))
    await vi.waitFor(() => expect(calls.some((call) => call.channel === 'changes.commits')).toBe(true))
    rerender(view({ epic: 'demo', num: 4 }))
    await screen.findAllByTestId('changes-line')
    await release()
    fireEvent.click(screen.getByTestId('changes-scope'))
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map((item) => item.getAttribute('data-scope'))).toEqual(['all', 'uncommitted', 'commit', 'commit'])
  })

  it('a patch read for an earlier Refresh that answers after the current one is dropped, not left «Loading…»', async () => {
    const entries = [{ key: fileKey('demo', 'src/orders/cart.ts'), repo: 'demo', file: changed('src/orders/cart.ts') }]
    const pane = (generation: number) => {
      const props: DiffPaneProps = { projectId: PROJECT, subject: { kind: 'ticket', epic: 'demo', num: 3 }, scope: { kind: 'all' }, hideWhitespace: false, layout: 'inline', wrap: false, entries, several: false, selected: null, generation }
      return <DiffPane {...props} />
    }
    const release = holdOnce('changes.file')
    const { rerender } = render(pane(0))
    await settle()
    rerender(pane(1))
    await settle()
    expect(fileCalls('src/orders/cart.ts')).toHaveLength(2)
    expect(within(diff()).getAllByTestId('changes-line')).toHaveLength(5)
    await release()
    expect(within(diff()).queryByText('Loading…')).toBeNull()
    expect(within(diff()).getAllByTestId('changes-line')).toHaveLength(5)
  })
})

describe('the measure of the drawn blocks', () => {
  it('a new Wrap measures the blocks on screen again, and a file of the tree scrolls by the new heights', async () => {
    const observers: { watched: Set<Element>; report: ResizeObserverCallback }[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        watched = new Set<Element>()
        report: ResizeObserverCallback
        constructor(report: ResizeObserverCallback) {
          this.report = report
          observers.push(this)
        }
        observe(element: Element) {
          this.watched.add(element)
        }
        unobserve(element: Element) {
          this.watched.delete(element)
        }
        disconnect() {
          this.watched.clear()
        }
      },
    )
    const watchedBlocks = () => new Set(observers.flatMap((each) => [...each.watched]).filter((element) => element instanceof HTMLElement && element.dataset.block !== undefined))
    // Every block on screen is `height` px tall, as each observer that watches it reports.
    let height = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height }) as DOMRect)
    const report = async (next: number) => {
      height = next
      await act(async () => {
        for (const each of observers) each.report([...each.watched].map((target) => ({ target }) as ResizeObserverEntry), each as unknown as ResizeObserver)
      })
    }
    // The blocks above the header of assets/logo.png: cart.ts and discount.ts, a header and a hunk each. Back at the
    // first file after it, so that they are drawn, and measured, again.
    const logoAt = async () => {
      fireEvent.click(screen.getAllByTestId('changes-tree-file')[2]!)
      await settle()
      const at = diff().scrollTop
      fireEvent.click(screen.getAllByTestId('changes-tree-file')[0]!)
      await settle()
      expect(diff().scrollTop).toBe(0)
      return at
    }
    await open()
    const blocks = () => diff().querySelectorAll('[data-block]')
    expect(blocks().length).toBeGreaterThan(0)
    expect(watchedBlocks().size).toBe(blocks().length)
    await report(300)
    expect(await logoAt()).toBe(4 * 300)

    fireEvent.click(screen.getByTestId('changes-wrap'))
    await settle()
    expect(diff().getAttribute('data-wrap')).toBe('true')
    expect(watchedBlocks().size).toBe(blocks().length)
    await report(500)
    expect(await logoAt()).toBe(4 * 500)

    fireEvent.click(screen.getByTestId('changes-side-by-side'))
    await settle()
    expect(watchedBlocks().size).toBe(blocks().length)
    await report(200)
    expect(await logoAt()).toBe(4 * 200)
  })
})

describe('diff-window.ts', () => {
  it('pairs the deleted lines with the added ones after them', () => {
    const rows = sideBySideRows([line('del', 'a', 1, null), line('del', 'b', 2, null), line('add', 'c', null, 1), line('context', 'd', 3, 2), line('add', 'e', null, 3)])
    expect(rows.map((row) => [row.old?.text ?? null, row.new?.text ?? null])).toEqual([
      ['a', 'c'],
      ['b', null],
      ['d', 'd'],
      [null, 'e'],
    ])
  })

  it('draws the blocks on screen and two screens around it, and stands the rest as space', () => {
    const heights = Array.from({ length: 100 }, () => 100)
    expect(windowOf(heights, 0, 200)).toEqual({ start: 0, end: 6, before: 0, after: 9400 })
    expect(windowOf(heights, 5000, 200)).toEqual({ start: 46, end: 56, before: 4600, after: 4400 })
    expect(windowOf(heights, 9800, 200)).toEqual({ start: 94, end: 100, before: 9400, after: 0 })
  })
})

// The diff of a pull request (worfy-pr-review ticket 06): DiffPane with the subject `pr`, the review threads of GitHub
// on their lines and the outdated ones under the file's header, a file GitHub sent without patch, «View file on
// GitHub», and the tree's line when GitHub listed only the first 3,000 files.
describe('the diff of a pull request', () => {
  const PR = { kind: 'pr', repo: 'acme/api', number: 7, headOid: 'b0b'.padEnd(40, '0'), baseOid: 'c0c'.padEnd(40, '0') } as const
  const URL = 'https://github.com/acme/api/blob/b0b/src/orders/cart.ts'
  const comment = (id: string, author: string, body: string) => ({ id, databaseId: 1, author, body, createdAt: '2026-11-19T10:00:00Z', url: `https://github.com/acme/api/pull/7#${id}` })
  const thread = (id: string, line: number | null, over: Partial<ChangesThread> = {}): ChangesThread => ({ id, isResolved: false, isOutdated: false, path: 'src/orders/cart.ts', line, viewerCanReply: true, comments: [comment(`c-${id}`, 'bob', `Why ${id}?`)], ...over })
  const entries = [
    { key: fileKey('acme/api', 'src/orders/cart.ts'), repo: 'acme/api', file: changed('src/orders/cart.ts', { url: URL }) },
    { key: fileKey('acme/api', 'data/big.json'), repo: 'acme/api', file: changed('data/big.json', { additions: 30_000, deletions: 0, url: 'https://github.com/acme/api/blob/b0b/data/big.json' }) },
  ]
  const pane = (over: Partial<DiffPaneProps> = {}) => <DiffPane projectId={PROJECT} subject={PR} scope={{ kind: 'all' }} hideWhitespace={false} layout="inline" wrap={false} entries={entries} several={false} selected={null} generation={0} {...over} />

  it('reads each file with the PR as its subject', async () => {
    render(pane())
    await settle()
    const asked = calls.filter((each) => each.channel === 'changes.file')
    expect(asked.map((each) => [each.input.subject, each.input.repo, each.input.path])).toEqual([
      [PR, 'acme/api', 'src/orders/cart.ts'],
      [PR, 'acme/api', 'data/big.json'],
    ])
  })

  it('a thread stands under its line of the new side; an outdated one and one without a line under the header; Reply goes to the PR inbox', async () => {
    const onReply = vi.fn()
    render(pane({ threads: [thread('t1', 3), thread('t2', 9, { isOutdated: true }), thread('t3', null, { viewerCanReply: false }), thread('t4', 3, { path: 'other.ts' })], onReply }))
    await settle()
    const rows = screen.getAllByTestId('changes-line')
    const added = rows.find((row) => row.getAttribute('data-line') === '3' && row.getAttribute('data-kind') === 'add')!
    const under = added.nextElementSibling as HTMLElement
    expect(under.getAttribute('data-testid')).toBe('changes-thread')
    expect(under.getAttribute('data-thread-id')).toBe('t1')
    expect(within(under).getByText('Why t1?')).toBeTruthy()
    expect(within(under).getByText(/open thread on GitHub/u)).toBeTruthy()
    const outdated = screen.getByTestId('changes-outdated')
    expect(within(outdated).getByText('2 threads not on a line of this diff')).toBeTruthy()
    expect(within(outdated).getAllByTestId('changes-thread').map((each) => each.getAttribute('data-thread-id'))).toEqual(['t2', 't3'])
    expect(within(outdated).getAllByTestId('changes-thread-where').map((each) => each.textContent)).toEqual(['outdated', 'no line'])
    // A thread of a file that is not in the diff stands nowhere.
    expect(screen.queryByText('Why t4?')).toBeNull()
    // Reply only where GitHub lets the viewer reply.
    expect(screen.getAllByTestId('changes-thread-reply')).toHaveLength(2)
    fireEvent.click(within(under).getByTestId('changes-thread-reply'))
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }))
  })

  // Review round 1: the side of a thread, a line the hunks do not have, and the scopes whose numbers are not the PR's.
  const threadUnder = (row: HTMLElement): string[] => {
    const ids: string[] = []
    for (let next = row.nextElementSibling; next?.getAttribute('data-testid') === 'changes-thread'; next = next.nextElementSibling) ids.push(next.getAttribute('data-thread-id')!)
    return ids
  }
  const lineRow = (kind: string, number: string) => screen.getAllByTestId('changes-line').find((row) => row.getAttribute('data-kind') === kind && row.getAttribute('data-line') === number)!
  const listed = () => {
    const list = screen.queryByTestId('changes-outdated')
    return list === null ? [] : within(list).getAllByTestId('changes-thread').map((each) => each.getAttribute('data-thread-id'))
  }

  it('a thread on a deleted line (LEFT) stands under that line of the old file, not under the new line of the same number', async () => {
    render(pane({ threads: [thread('left', 2, { side: 'LEFT' }), thread('right', 2, { side: 'RIGHT' })] }))
    await settle()
    expect(threadUnder(lineRow('del', '2'))).toEqual(['left'])
    expect(threadUnder(lineRow('add', '2'))).toEqual(['right'])
    expect(listed()).toEqual([])
  })

  it('a thread on a line the hunks do not have stands in the list under the header, with its line', async () => {
    render(pane({ threads: [thread('far', 101), thread('gone', 9, { side: 'LEFT' }), thread('near', 3)] }))
    await settle()
    expect(listed()).toEqual(['far', 'gone'])
    expect(within(screen.getByTestId('changes-outdated')).getAllByTestId('changes-thread-where').map((each) => each.textContent)).toEqual(['line 101', 'old line 9'])
    expect(threadUnder(lineRow('add', '3'))).toEqual(['near'])
  })

  it('Side by side: a thread on a line both sides show stands under it once', async () => {
    render(pane({ layout: 'side-by-side', threads: [thread('old1', 1, { side: 'LEFT' }), thread('new4', 4)] }))
    await settle()
    expect(screen.getAllByTestId('changes-thread').map((each) => each.getAttribute('data-thread-id'))).toEqual(['old1', 'new4'])
    expect(listed()).toEqual([])
  })

  it('a Commit has numbers of its own: every thread stands in the list; Since my review keeps the new side on its lines, the old side in the list', async () => {
    const threads = [thread('right', 3), thread('left', 2, { side: 'LEFT' })]
    const { unmount } = render(pane({ scope: { kind: 'commit', repo: 'acme/api', sha: 'd0d'.padEnd(40, '0') }, threads }))
    await settle()
    expect(threadUnder(lineRow('add', '3'))).toEqual([])
    expect(listed()).toEqual(['right', 'left'])
    unmount()
    render(pane({ scope: { kind: 'compare', repo: 'acme/api', ref: 'e0e'.padEnd(40, '0') }, threads }))
    await settle()
    expect(threadUnder(lineRow('add', '3'))).toEqual(['right'])
    expect(threadUnder(lineRow('del', '2'))).toEqual([])
    expect(listed()).toEqual(['left'])
  })

  it('without threads there is no thread and no Reply', async () => {
    render(pane())
    await settle()
    expect(screen.queryByTestId('changes-thread')).toBeNull()
    expect(screen.queryByTestId('changes-outdated')).toBeNull()
  })

  it('a file without patch reads «Large diff · Open on GitHub»; a file read from GitHub has «View file on GitHub»; both open the system browser', async () => {
    render(pane())
    await settle()
    const note = screen.getByTestId('changes-no-patch')
    expect(note.textContent).toBe('Large diff · Open on GitHub')
    expect(screen.getAllByTestId('changes-view-on-github')).toHaveLength(2)
    fireEvent.click(within(note).getByTestId('changes-open-github'))
    fireEvent.click(screen.getAllByTestId('changes-view-on-github')[0]!)
    await settle()
    expect(calls.filter((each) => each.channel === 'shell.openExternal').map((each) => each.input.url)).toEqual(['https://github.com/acme/api/blob/b0b/data/big.json', URL])
  })

  it('a Ticket’s file has no «View file on GitHub»', async () => {
    render(pane({ subject: { kind: 'ticket', epic: 'demo', num: 3 }, entries: [{ key: fileKey('demo', 'src/orders/cart.ts'), repo: 'demo', file: changed('src/orders/cart.ts') }] }))
    await settle()
    expect(screen.queryByTestId('changes-view-on-github')).toBeNull()
  })

  it('the tree says when GitHub listed only the first 3,000 files', () => {
    const props = { repos: [{ repo: 'acme/big', files: [changed('a.ts')], error: null }], filter: '', onFilter: () => undefined, selected: null, onSelect: () => undefined, workflowOpen: false, onWorkflowOpen: () => undefined, toggled: new Set<string>(), onToggle: () => undefined }
    const { rerender } = render(<FileTree {...props} truncatedAt={3_000} />)
    expect(screen.getByTestId('changes-truncated').textContent).toBe('GitHub lists the first 3,000 files')
    rerender(<FileTree {...props} truncatedAt={null} />)
    expect(screen.queryByTestId('changes-truncated')).toBeNull()
  })

  it('the view of a Ticket asks `changes.*` with the Ticket as its subject', async () => {
    render(view())
    await settle()
    const list = calls.find((each) => each.channel === 'changes.list')
    expect(list?.input.subject).toMatchObject({ kind: 'ticket', epic: 'demo', num: 3 })
    expect(list?.input).not.toHaveProperty('ticket')
  })
})

// worfy-changes-view ticket 08: the Changes of a Ticket over the whole window, with one button back.
describe('the view over the window', () => {
  const screenOf = (activeProjectId: string = PROJECT) => <ChangesScreen activeProjectId={activeProjectId} />

  it('draws the head of scopes, the tree and the diff of the Ticket under «← Canvas»', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    const shown = screen.getByTestId('changes-view')
    expect(shown.getAttribute('data-ticket')).toBe('demo/03')
    expect(screen.getByTestId('changes-back').textContent).toBe('← Canvas')
    expect(screen.getByTestId('changes-meta').textContent).toBe('origin/main ← demo/03 · base 4f9c2e1 · 4 files + 2 workflow · +1269 −3')
    expect(screen.getAllByTestId('changes-tree-file').map((row) => row.getAttribute('data-path'))).toEqual(['src/orders/cart.ts', 'src/orders/discount.ts', 'assets/logo.png', 'data/catalog.json'])
    // The focus is on the view at its opening, so its keys work at once.
    expect(document.activeElement).toBe(screen.getByTestId('changes-body'))
  })

  it('«← Canvas» goes back to the Canvas', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    expect(useNavigation.getState().view).toBe('changes')
    fireEvent.click(screen.getByTestId('changes-back'))
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('Esc goes back to the Canvas; not while the focus is in a text field', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    fireEvent.keyDown(screen.getByTestId('changes-filter'), { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('changes')
    fireEvent.keyDown(screen.getByTestId('changes-body'), { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('Esc with a menu open closes only the menu; the next Esc goes back', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    fireEvent.click(screen.getByTestId('changes-scope'))
    const item = (await screen.findAllByRole('menuitemradio'))[0]!
    fireEvent.keyDown(item, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(useNavigation.getState().view).toBe('changes')
    fireEvent.keyDown(screen.getByTestId('changes-body'), { key: 'Escape' })
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('takes no keys while another view is shown', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    setView('session')
    await settle()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.keyDown(window, { key: 'n' })
    expect(useNavigation.getState().view).toBe('session')
    expect(diff().scrollTop).toBe(0)
  })

  it('another Project picked in the sidebar goes back to the Canvas', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    const { rerender } = render(screenOf())
    await screen.findAllByTestId('changes-line')
    rerender(screenOf('other-0000000e'))
    expect(useNavigation.getState().view).toBe('canvas')
  })

  it('opened from a message of the Session view at a line: «← Session» goes back there, and the line is brought into view', async () => {
    const { openChangesAtLine } = await import('../../src/renderer/changes/open')
    setView('session')
    openChangesAtLine(PROJECT, { epic: 'demo', num: 3 }, { path: 'src/orders/discount.ts', side: 'new', line: 2 })
    expect(useNavigation.getState().view).toBe('changes')
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    // The header of cart.ts, its hunk and the gap under it come first: the line of discount.ts is past them.
    await vi.waitFor(() => expect(diff().scrollTop).toBeGreaterThanOrEqual(34 + 122 + 12))
    expect(screen.getByTestId('changes-back').textContent).toBe('← Session')
    fireEvent.click(screen.getByTestId('changes-back'))
    expect(useNavigation.getState().view).toBe('session')
  })

  it('keeps the scope picked for each Ticket while the window lives', async () => {
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    const { unmount } = render(screenOf())
    await screen.findAllByTestId('changes-line')
    fireEvent.click(screen.getByTestId('changes-scope'))
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Uncommitted/u }))
    unmount()
    openChanges(PROJECT, { epic: 'demo', num: 4 })
    render(screenOf())
    await screen.findAllByTestId('changes-line')
    expect(screen.getByTestId('changes-view').getAttribute('data-scope')).toBe('all')
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    await vi.waitFor(() => expect(screen.getByTestId('changes-view').getAttribute('data-ticket')).toBe('demo/03'))
    expect(screen.getByTestId('changes-view').getAttribute('data-scope')).toBe('uncommitted')
  })
})

describe('the line asked for by a message', () => {
  it('another opening of the view drops it, so the view does not jump to an old line', async () => {
    const { lineRequestFor, openChangesAtLine, useLineRequests } = await import('../../src/renderer/changes/open')
    openChangesAtLine(PROJECT, { epic: 'demo', num: 3 }, { path: 'src/orders/cart.ts', side: 'new', line: 2 })
    expect(lineRequestFor(useLineRequests.getState().request, PROJECT, { epic: 'demo', num: 3 })).toMatchObject({ path: 'src/orders/cart.ts', line: 2 })
    openChanges(PROJECT, { epic: 'demo', num: 3 })
    expect(lineRequestFor(useLineRequests.getState().request, PROJECT, { epic: 'demo', num: 3 })).toBeNull()
  })
})
