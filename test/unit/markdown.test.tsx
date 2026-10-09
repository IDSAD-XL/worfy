// The shared markdown renderer (src/renderer/markdown/Markdown.tsx): GitHub-flavoured tables and
// task lists, raw HTML shown as text and never executed, and the two kinds of links: https://
// addresses go to the browser (`shell.openExternal`), relative paths to the Project's file in the
// default editor (`shell.openInEditor`). Anything else is not a link at all.
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '../../src/renderer/markdown/Markdown'
import { classifyLink } from '../../src/renderer/markdown/links'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const asked: { channel: string; input: unknown }[] = []

beforeEach(() => {
  asked.length = 0
  const bridge = {
    invoke: (channel: string, input: unknown) => {
      asked.push({ channel, input })
      return Promise.resolve({ ok: true, value: {} })
    },
    on: () => 1,
    off: () => undefined,
  } as unknown as WorfyBridge
  ;(globalThis as { worfy?: WorfyBridge }).worfy = bridge
})

afterEach(() => {
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  delete (globalThis as { pwned?: unknown }).pwned
})

describe('Markdown: raw HTML', () => {
  it('does not create an <img> from raw HTML, so its onerror never runs', () => {
    const { container } = render(<Markdown text={'before <img src="x" onerror="globalThis.pwned = 1"> after'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined()
    // The tag is shown as text, so the reader sees what the agent wrote.
    expect(container.textContent).toContain('<img src="x" onerror="globalThis.pwned = 1">')
  })

  it('does not create a <script> from raw HTML, inline or as a block', () => {
    const text = ['Inline <script>globalThis.pwned = 1</script> text.', '', '<script>', 'globalThis.pwned = 2', '</script>'].join('\n')
    const { container } = render(<Markdown text={text} />)
    expect(container.querySelector('script')).toBeNull()
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined()
    expect(container.textContent).toContain('<script>')
  })

  it('does not load markdown images: an image becomes its alt text', () => {
    const { container } = render(<Markdown text={'![diagram](https://example.com/x.png)'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('diagram')).toBeTruthy()
  })
})

describe('Markdown: GitHub-flavoured syntax', () => {
  it('renders a table with its header and cells', () => {
    const { container } = render(<Markdown text={['| Ticket | State |', '| --- | --- |', '| 07 | done |', '| 08 | busy |'].join('\n')} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect([...(table?.querySelectorAll('th') ?? [])].map((cell) => cell.textContent)).toEqual(['Ticket', 'State'])
    expect([...(table?.querySelectorAll('td') ?? [])].map((cell) => cell.textContent)).toEqual(['07', 'done', '08', 'busy'])
  })

  it('renders a task list as disabled checkboxes with their state', () => {
    const { container } = render(<Markdown text={['- [x] tests', '- [ ] review'].join('\n')} />)
    const boxes = [...container.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[]
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ])
  })
})

describe('Markdown: line breaks', () => {
  const block = ['— Этап: волна 6', '— Сейчас: тикет 33', '— Дальше: PR', '— Жду: ничего'].join('\n')

  it('with `breaks`, keeps each line of a paragraph on its own line, and leaves code alone', () => {
    const { container } = render(<Markdown text={`${block}\n\n\`\`\`\na\nb\n\`\`\``} breaks />)
    expect(container.querySelectorAll('p br')).toHaveLength(3)
    expect(container.querySelector('pre')?.textContent).toBe('a\nb\n')
    expect(container.querySelector('pre br')).toBeNull()
  })

  it('without it, joins the lines of a paragraph as GitHub does', () => {
    const { container } = render(<Markdown text={block} />)
    expect(container.querySelectorAll('br')).toHaveLength(0)
  })
})

describe('Markdown: links', () => {
  it('opens an https:// link in the browser through shell.openExternal', () => {
    render(<Markdown text={'See [the PR](https://github.com/IDSAD-XL/worfy/pull/12).'} projectId="alpha" />)
    // false: the click's default action, navigating the window itself, was prevented.
    expect(fireEvent.click(screen.getByRole('link', { name: 'the PR' }))).toBe(false)
    expect(asked).toEqual([{ channel: 'shell.openExternal', input: { url: 'https://github.com/IDSAD-XL/worfy/pull/12' } }])
  })

  it('opens a relative link as a file of the Project through shell.openInEditor', () => {
    render(<Markdown text={'Decided in [ADR 0002](../adr/0002-view.md#considered-options).'} projectId="alpha" baseDir="docs/design" />)
    expect(fireEvent.click(screen.getByRole('link', { name: 'ADR 0002' }))).toBe(false)
    expect(asked).toEqual([{ channel: 'shell.openInEditor', input: { projectId: 'alpha', path: 'docs/adr/0002-view.md' } }])
  })

  it('without a Project, a relative link opens nothing', () => {
    render(<Markdown text={'[spec](spec.md)'} />)
    fireEvent.click(screen.getByText('spec'))
    expect(asked).toEqual([])
  })

  // worfy-windows ticket 08: react-markdown's default urlTransform blanked these before classifyLink.
  it.each([
    ['[f](C:\\Users\\a\\f.md)', 'C:\\Users\\a\\f.md'],
    ['[f](C:/Users/a/f.md)', 'C:\\Users\\a\\f.md'],
    // In markdown `\\` is an escaped backslash: a UNC path is written with four.
    ['[f](\\\\\\\\server\\share\\f.md)', '\\\\server\\share\\f.md'],
  ])('opens an absolute Windows path %s as a file through shell.openInEditor', (text, path) => {
    render(<Markdown text={text} projectId="alpha" />)
    expect(fireEvent.click(screen.getByRole('link', { name: 'f' }))).toBe(false)
    expect(asked).toEqual([{ channel: 'shell.openInEditor', input: { projectId: 'alpha', path } }])
  })

  it('keeps blanking a drive-letter scheme that is not a path, such as c:alert(1)', () => {
    const { container } = render(<Markdown text={'[x](c:alert(1))'} projectId="alpha" />)
    expect(container.querySelector('a')).toBeNull()
  })

  it('a javascript: or http:// link is not a link and opens nothing', () => {
    const { container } = render(<Markdown text={'[run](javascript:alert(1)) and [plain](http://example.com)'} projectId="alpha" />)
    expect(container.querySelector('a')).toBeNull()
    fireEvent.click(screen.getByText('run'))
    fireEvent.click(screen.getByText('plain'))
    expect(asked).toEqual([])
  })
})

describe('classifyLink', () => {
  it.each([
    ['https://example.com/a?b=1#c', { kind: 'external', url: 'https://example.com/a?b=1#c' }],
    ['HTTPS://example.com', { kind: 'external', url: 'https://example.com/' }],
    ['docs/adr/0001.md', { kind: 'file', path: 'docs/adr/0001.md' }],
    ['./a/../b/c.md?x=1#top', { kind: 'file', path: 'b/c.md' }],
    ['/Users/test/projects/demo/README.md', { kind: 'file', path: '/Users/test/projects/demo/README.md' }],
    ['docs/F%20SPEC.md', { kind: 'file', path: 'docs/F SPEC.md' }],
    ['http://example.com', { kind: 'none' }],
    ['javascript:alert(1)', { kind: 'none' }],
    ['mailto:a@b.c', { kind: 'none' }],
    ['//example.com/x', { kind: 'none' }],
    ['#heading', { kind: 'none' }],
    ['', { kind: 'none' }],
    [undefined, { kind: 'none' }],
  ])('%s', (href, expected) => {
    expect(classifyLink(href)).toEqual(expected)
  })

  it('resolves a relative path against the directory of the document', () => {
    expect(classifyLink('../../src/main/index.ts', '.scratch/worfy-mvp')).toEqual({ kind: 'file', path: 'src/main/index.ts' })
    expect(classifyLink('0002.md', 'docs/adr/')).toEqual({ kind: 'file', path: 'docs/adr/0002.md' })
  })

  // worfy-windows ticket 08: a Windows path is a file, not a `c:` scheme.
  it.each([
    ['C:\\docs\\a.md', 'C:\\docs\\a.md'],
    ['C:/docs/a.md', 'C:\\docs\\a.md'],
    ['c:\\docs\\.\\x\\..\\a.md#top', 'C:\\docs\\a.md'],
    ['C:\\docs\\F%20SPEC.md', 'C:\\docs\\F SPEC.md'],
    ['\\\\server\\share\\a.md', '\\\\server\\share\\a.md'],
    // As the markdown parser hands it over: `\` percent-encoded.
    ['C:%5Cdocs%5Ca.md', 'C:\\docs\\a.md'],
    ['%5C%5Cserver%5Cshare%5Ca.md', '\\\\server\\share\\a.md'],
  ])('%s is a file with an absolute Windows path', (href, path) => {
    expect(classifyLink(href, 'docs')).toEqual({ kind: 'file', path })
  })

  it('takes `\\` in a relative link as a separator, and a drive root or a bare drive as nothing to open', () => {
    expect(classifyLink('docs\\adr\\0001.md')).toEqual({ kind: 'file', path: 'docs/adr/0001.md' })
    expect(classifyLink('..\\src\\main\\index.ts', '.scratch/worfy-mvp')).toEqual({ kind: 'file', path: '.scratch/src/main/index.ts' })
    expect(classifyLink('C:\\')).toEqual({ kind: 'none' })
    // An absolute POSIX path keeps `\` as part of a name.
    expect(classifyLink('/a/b\\c.md')).toEqual({ kind: 'file', path: '/a/b\\c.md' })
    expect(classifyLink('C:a.md')).toEqual({ kind: 'none' })
  })
})

// worfy-link ticket 12 (ADR-0053, Q14): in a window on Linked machine M an https:// link opens on
// this Machine — `shell.openExternal` goes to the window's own main, not to M as `linked.invoke` —
// and a link to a Project file shows "File is on <M>" instead of any call.
describe('Markdown: links in a window on a Linked machine', () => {
  const M = '7d3c1a52-0b8e-4c39-9a51-2f6d8e4b7a10'

  const linkState = (name: string) => ({
    revision: 1_000_000,
    machine: null,
    problem: null,
    listening: true,
    addresses: [],
    bonjour: false,
    linking: { open: false, code: null, expiresAt: null, linked: null, failure: null },
    linked: [{ id: M, name, state: 'online', certificateChanged: false }],
    discovered: [],
    projectsAccess: false,
    keepAwake: false,
  })

  beforeEach(() => {
    window.history.replaceState(null, '', `/?machine=${M}&project=alpha`)
    ;(globalThis as { worfy?: WorfyBridge }).worfy = {
      invoke: (channel: string, input: unknown) => {
        asked.push({ channel, input })
        if (channel === 'link.state') return Promise.resolve({ ok: true, value: linkState('Mini') })
        return Promise.resolve({ ok: true, value: {} })
      },
      on: () => 1,
      off: () => undefined,
    } as unknown as WorfyBridge
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('an https:// link calls shell.openExternal through the bridge of this Machine', () => {
    render(<Markdown text={'See [the PR](https://github.com/IDSAD-XL/worfy/pull/12).'} projectId="alpha" />)
    expect(fireEvent.click(screen.getByRole('link', { name: 'the PR' }))).toBe(false)
    expect(asked).toEqual([{ channel: 'shell.openExternal', input: { url: 'https://github.com/IDSAD-XL/worfy/pull/12' } }])
  })

  it('a link to a Project file shows "File is on Mini" and calls nothing on either Machine', async () => {
    render(<Markdown text={'Decided in [ADR 0002](../adr/0002-view.md).'} projectId="alpha" baseDir="docs/design" />)
    expect(screen.queryByTestId('file-elsewhere')).toBeNull()
    expect(fireEvent.click(screen.getByRole('link', { name: 'ADR 0002' }))).toBe(false)
    await vi.waitFor(() => expect(screen.getByTestId('file-elsewhere').textContent).toBe('File is on Mini'))
    // Only the link state of this Machine, for the name; no shell call here or on M.
    expect(asked.map((each) => each.channel).filter((channel) => channel !== 'link.state')).toEqual([])
  })
})
