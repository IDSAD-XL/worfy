// The GitHub reading of the shared markdown renderer (prop `github` of src/renderer/markdown/Markdown.tsx,
// worfy-polish ticket 104): a comment of a pull request shown as GitHub shows it — every block and inline element of
// GitHub-flavoured markdown, a ```suggestion block, `@login` mentions, `#N` references — with raw HTML kept as text,
// no image fetched, and links leaving only through shell.openExternal. Without the prop nothing of this applies.
// The texts are invented.
import { fireEvent, render, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '../../src/renderer/markdown/Markdown'
import type { WorfyBridge } from '../../src/shared/ipc/channels'

const REPO = 'acme-labs/widget'
const asked: { channel: string; input: unknown }[] = []
const fetched = vi.fn()

beforeEach(() => {
  asked.length = 0
  fetched.mockClear()
  vi.stubGlobal('fetch', fetched)
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
  vi.unstubAllGlobals()
  delete (globalThis as { worfy?: WorfyBridge }).worfy
  delete (globalThis as { pwned?: unknown }).pwned
})

const comment = (text: string, repo: string | null = REPO) => render(<Markdown text={text} breaks github={{ repo }} />).container

const opened = () => asked.filter((call) => call.channel === 'shell.openExternal').map((call) => (call.input as { url: string }).url)

describe('Markdown with `github`: the elements of GitHub-flavoured markdown', () => {
  it('marks the block as a GitHub comment, for its own heading sizes and table scroll', () => {
    expect(comment('text').querySelector('.w-md.w-md--github')).not.toBeNull()
  })

  it('renders bold, italic, strikethrough and inline code', () => {
    const body = comment('**firm** and _soft_ and ~~gone~~ and `retry()`')
    expect(body.querySelector('strong')?.textContent).toBe('firm')
    expect(body.querySelector('em')?.textContent).toBe('soft')
    expect(body.querySelector('del')?.textContent).toBe('gone')
    expect(body.querySelector('code')?.textContent).toBe('retry()')
    expect(body.textContent).not.toContain('**')
  })

  it('keeps paragraphs apart and a single newline as a line break, as a GitHub comment does', () => {
    const body = comment('First line\nsecond line\n\nNext paragraph')
    expect([...body.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['First line\nsecond line', 'Next paragraph'])
    expect(body.querySelectorAll('p')[0]?.querySelector('br')).not.toBeNull()
  })

  it('renders a bulleted list with a nested ordered one', () => {
    const body = comment(['- outer one', '  1. inner first', '  2. inner second', '- outer two'].join('\n'))
    const outer = body.querySelector('ul')
    expect(outer).not.toBeNull()
    expect(outer?.querySelectorAll(':scope > li')).toHaveLength(2)
    expect([...(outer?.querySelectorAll('ol > li') ?? [])].map((li) => li.textContent)).toEqual(['inner first', 'inner second'])
  })

  it('renders an ordered list that starts at its own number', () => {
    const body = comment(['3. third', '4. fourth'].join('\n'))
    expect(body.querySelector('ol')?.getAttribute('start')).toBe('3')
  })

  it('renders a blockquote', () => {
    expect(comment('> quoted words').querySelector('blockquote')?.textContent?.trim()).toBe('quoted words')
  })

  it('renders a fenced code block as a code block, its text untouched', () => {
    const body = comment(['```ts', 'const n = 1 // see #12 and @someone', '```'].join('\n'))
    const code = body.querySelector('pre > code')
    expect(code?.className).toContain('language-ts')
    expect(code?.textContent).toBe('const n = 1 // see #12 and @someone\n')
    expect(code?.querySelector('a')).toBeNull()
  })

  it('renders a table', () => {
    const body = comment(['| Step | Result |', '| --- | --- |', '| build | ok |'].join('\n'))
    expect([...body.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Step', 'Result'])
    expect([...body.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['build', 'ok'])
  })

  it('renders a task list as read-only checkboxes', () => {
    const boxes = [...comment(['- [x] tests', '- [ ] docs'].join('\n')).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [true, true],
      [false, true],
    ])
  })

  it('renders headings and a horizontal rule', () => {
    const body = comment(['# Summary', '', '### Details', '', '---', '', 'after'].join('\n'))
    expect(body.querySelector('h1')?.textContent).toBe('Summary')
    expect(body.querySelector('h3')?.textContent).toBe('Details')
    expect(body.querySelector('hr')).not.toBeNull()
  })
})

describe('Markdown with `github`: a suggestion block', () => {
  it('shows a ```suggestion block as a labelled suggested change, one line per line', () => {
    const body = comment(['Maybe:', '', '```suggestion', 'const tries = 3', '', 'return tries', '```'].join('\n'))
    const block = within(body).getByTestId('md-suggestion')
    expect(within(block).getByText('Suggested change')).toBeTruthy()
    expect([...block.querySelectorAll('.w-md__suggestion-line')].map((line) => line.textContent)).toEqual(['const tries = 3', '​', 'return tries'])
    // Only the suggestion is a suggested change: no plain code block is left behind it.
    expect(body.querySelectorAll('pre')).toHaveLength(1)
  })

  it('shows an empty suggestion as deleting the lines', () => {
    const block = within(comment(['```suggestion', '```'].join('\n'))).getByTestId('md-suggestion')
    expect(block.textContent).toBe('Suggested changeDelete the lines')
  })

  it('leaves a code block in another language a plain code block', () => {
    const body = comment(['```diff', '+ added', '```'].join('\n'))
    expect(within(body).queryByTestId('md-suggestion')).toBeNull()
    expect(body.querySelector('pre > code')?.textContent).toBe('+ added\n')
  })
})

describe('Markdown with `github`: mentions and references', () => {
  it('links @login to the person on GitHub, styled as a mention, and opens it in the browser', () => {
    const body = comment('Thanks @octo-dev, see @team-lead.')
    const mentions = [...body.querySelectorAll('a.w-md__mention')]
    expect(mentions.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['@octo-dev', 'https://github.com/octo-dev'],
      ['@team-lead', 'https://github.com/team-lead'],
    ])
    fireEvent.click(mentions[0]!)
    expect(opened()).toEqual(['https://github.com/octo-dev'])
  })

  it('links @org/team to the team page', () => {
    const link = comment('cc @acme-labs/reviewers').querySelector('a.w-md__mention')
    expect([link?.textContent, link?.getAttribute('href')]).toEqual(['@acme-labs/reviewers', 'https://github.com/orgs/acme-labs/teams/reviewers'])
  })

  it('does not take an e-mail address, a word with @ inside, or code for a mention', () => {
    const body = comment('Write to dev@example.org or a@b, run `npm i @scope/pkg`.')
    expect(body.querySelector('a.w-md__mention')).toBeNull()
    expect(body.querySelector('code')?.textContent).toBe('npm i @scope/pkg')
  })

  it("links #N to that issue or PR of the PR's own repository", () => {
    const link = comment('Same as #42, fixed in (#7).').querySelectorAll('a.w-md__ref')
    expect([...link].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['#42', `https://github.com/${REPO}/issues/42`],
      ['#7', `https://github.com/${REPO}/issues/7`],
    ])
    fireEvent.click(link[0]!)
    expect(opened()).toEqual([`https://github.com/${REPO}/issues/42`])
  })

  it('links owner/name#N into that repository', () => {
    const link = comment('Depends on other-org/tools#5').querySelector('a.w-md__ref')
    expect([link?.textContent, link?.getAttribute('href')]).toEqual(['other-org/tools#5', 'https://github.com/other-org/tools/issues/5'])
  })

  it('leaves #N text when the repository is not known, after a word, as #0, or inside code', () => {
    expect(comment('see #42', null).querySelector('a')).toBeNull()
    const body = comment('item#3, #0, `#12` and #1a')
    expect(body.querySelector('a')).toBeNull()
  })

  it('keeps a full GitHub address a link to itself, its #fragment untouched', () => {
    const url = `https://github.com/${REPO}/pull/9#issuecomment-1`
    const links = [...comment(`Look at ${url} please`).querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([url])
    fireEvent.click(links[0]!)
    expect(opened()).toEqual([url])
  })
})

describe('Markdown with `github`: nothing runs and nothing is fetched', () => {
  it('shows raw HTML as text: <details>, <sub> and <script> create no element and run nothing', () => {
    const text = ['<details><summary>More</summary>', '', 'hidden part', '', '</details>', '', 'a <sub>small</sub> word <script>globalThis.pwned = 1</script>'].join('\n')
    const body = comment(text)
    expect(body.querySelector('details, summary, sub, script')).toBeNull()
    expect((globalThis as { pwned?: unknown }).pwned).toBeUndefined()
    expect(body.textContent).toContain('<details><summary>More</summary>')
    expect(body.textContent).toContain('<sub>')
  })

  it('hides an HTML comment, as GitHub does', () => {
    const body = comment(['<!-- template: describe the change -->', '', 'The change'].join('\n'))
    expect(body.textContent).toBe('The change')
  })

  it('keeps an HTML block that holds text between two comments: only a block of comments alone is hidden', () => {
    const body = comment(['<!-- a --> visible <!-- b -->', '', '<!-- one -->', '<!-- two -->', '', 'after'].join('\n'))
    expect(body.textContent).toContain('visible')
    expect(body.textContent).not.toContain('one')
    expect(body.textContent).toContain('after')
  })

  it('shows an image as a link with its alt text and fetches nothing; a click opens the address in the browser', () => {
    const body = comment('Before: ![login screen](https://example.com/shot.png)')
    expect(body.querySelector('img, [src]')).toBeNull()
    const link = body.querySelector('a.w-md__image-link')
    expect([link?.textContent, link?.getAttribute('href')]).toEqual(['login screen', 'https://example.com/shot.png'])
    fireEvent.click(link!)
    expect(opened()).toEqual(['https://example.com/shot.png'])
    expect(fetched).not.toHaveBeenCalled()
  })

  it('shows an image inside a link as its alt text: one link, no image', () => {
    const body = comment('[![build passing](https://example.com/badge.svg)](https://example.com/build/1)')
    expect(body.querySelector('img')).toBeNull()
    expect([...body.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com/build/1'])
    expect(body.querySelector('a .w-md__image')?.textContent).toBe('build passing')
    expect(fetched).not.toHaveBeenCalled()
  })

  it('an image whose address is not http(s) opens nothing', () => {
    const body = comment('![x](javascript:alert(1))')
    expect(body.querySelector('a')).toBeNull()
    expect(body.textContent).toBe('x')
  })
})

describe('Markdown without `github`: agent text renders as before', () => {
  it('leaves @login, #N and a suggestion block alone, and an image as its alt text', () => {
    const text = ['Hi @octo-dev, see #42 ![chart](https://example.com/c.png)', '', '```suggestion', 'x = 1', '```'].join('\n')
    const { container } = render(<Markdown text={text} />)
    expect(container.querySelector('.w-md--github')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('[data-testid="md-suggestion"]')).toBeNull()
    expect(container.querySelector('pre > code')?.textContent).toBe('x = 1\n')
    expect(container.querySelector('.w-md__image')?.textContent).toBe('chart')
  })
})
